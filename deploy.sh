#!/usr/bin/env bash
#
# Build → push to ECR → deploy to the KKS devops tenant cluster.
# Self-contained: this script travels with the app repo. Copy the whole template/
# into any Docker app and change the CONFIG block below — that one block is the
# single source of truth. deploy.sh injects it into k8s/*.yaml at apply time
# (placeholders __APP__ / __NAMESPACE__ / __HOST__ / __HEALTHCHECK_PATH__ /
# __IMAGE__), so you never edit the manifests by hand and can't leave a stray
# name behind.
#
# The normal way to run this is CI: push to the default branch and .gitlab-ci.yml
# runs it for you (ECR access via the runner's IRSA role; the only CI var you set
# is KUBECONFIG_B64, once, group-wide). Running it by hand below is the debug
# escape hatch.
#
# Prereqs for a manual local run (CI needs none of these — it uses IRSA):
#   - AWS creds for the ECR account (`awssso` login)
#   - kubectl pointed at your tenant namespace via the deployer-token kubeconfig
#     (export KUBECONFIG=/path/to/kubeconfig.yaml)
#   - docker (the build is pinned to linux/amd64, so an Apple Silicon Mac is fine)
#
# Usage:
#   ./deploy.sh                # build+push+deploy, tag = git short sha
#   IMAGE_TAG=v3 ./deploy.sh   # override the tag

set -euo pipefail

# ---------------------------------------------------------------- CONFIG ----
# The ONLY things you change per app. Everything else (manifests, CI) is copied
# verbatim and filled in from these values.
APP_NAME="jira-analysis"             # k8s name + ECR repo leaf; DNS-safe (a-z0-9-)
NAMESPACE="sb-apps"                  # your tenant namespace
HOST="${APP_NAME}.devops.kk.stream"  # public URL host (external-dns creates it)
HEALTHCHECK_PATH="/api/healthz"      # a path your app returns 200 on (probes + ALB)

AWS_REGION="ap-northeast-1"
ECR_REGISTRY="190446795153.dkr.ecr.ap-northeast-1.amazonaws.com"
ECR_REPO="${NAMESPACE}/${APP_NAME}"  # -> 190446795153.../sb-apps/my-app
# ----------------------------------------------------------------------------

cd "$(dirname "$0")"

# Guard against shipping the template's placeholder name: NAMESPACE is shared by
# every app in the group, so an unedited APP_NAME would deploy over whatever
# "my-app" happens to be there.
if [[ "${APP_NAME}" == "my-app" ]]; then
  echo "ERROR: APP_NAME is still the template placeholder 'my-app'." >&2
  echo "       Edit the CONFIG block at the top of deploy.sh before deploying." >&2
  exit 1
fi

TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${TAG}"

echo "==> app=${APP_NAME} ns=${NAMESPACE} image=${IMAGE}"

# 1. Sync secrets from CI/CD variables → k8s Secret (optional). Done first so a
#    misconfigured variable fails in seconds instead of after a full image build.
#    Set APP_SECRET_VARS="KEY1 KEY2" as a GitLab CI/CD variable (Masked OFF — a
#    space-separated list can't be masked) listing the *names* of the other masked
#    variables that hold the secret values. The resulting Secret is referenced via
#    envFrom in the Deployment (optional:true so the pod still starts without it),
#    and SECRET_HASH below is stamped on the pod template so a secret-only change
#    still triggers a rollout.
SECRET_HASH="none"
if [[ -n "${APP_SECRET_VARS:-}" ]]; then
  echo "==> sync k8s secret ${APP_NAME}-secrets"
  secret_args=(kubectl -n "${NAMESPACE}" create secret generic "${APP_NAME}-secrets")
  for var in ${APP_SECRET_VARS}; do
    if [[ -z "${!var:-}" ]]; then
      echo "ERROR: APP_SECRET_VARS lists ${var}, but no CI/CD variable ${var} is set" >&2
      exit 1
    fi
    secret_args+=(--from-literal="${var}=${!var}")
  done
  "${secret_args[@]}" --dry-run=client -o yaml | kubectl -n "${NAMESPACE}" apply -f -
  # sha256sum (coreutils), NOT shasum: shasum ships in Debian's `perl` package,
  # which the slim CI image doesn't have — it would exit 127 under `pipefail`.
  SECRET_HASH=$(kubectl -n "${NAMESPACE}" get secret "${APP_NAME}-secrets" \
    -o jsonpath='{.data}' | sha256sum | cut -c1-12)
elif [[ -n "${CI:-}" ]]; then
  # APP_SECRET_VARS was cleared/removed → drop the Secret, otherwise envFrom keeps
  # feeding the revoked credentials to every new pod. CI-only on purpose: a local
  # debug run has none of the CI/CD variables in its environment, so it must not
  # mistake "not set here" for "no longer wanted" and delete the real Secret.
  echo "==> no APP_SECRET_VARS; removing any stale secret ${APP_NAME}-secrets"
  kubectl -n "${NAMESPACE}" delete secret "${APP_NAME}-secrets" --ignore-not-found
fi

# 2. Log docker in to ECR.
echo "==> ECR login"
aws ecr get-login-password --region "${AWS_REGION}" |
  docker login --username AWS --password-stdin "${ECR_REGISTRY}"

# 3. Ensure the ECR repo exists. Only "not found" is expected — anything else
#    (typically AccessDenied when IRSA isn't wired up) must fail here with the
#    real message, instead of surfacing later as a cryptic `docker push` error.
echo "==> ensure ECR repo ${ECR_REPO}"
if ! ecr_err=$(aws ecr describe-repositories --region "${AWS_REGION}" \
      --repository-names "${ECR_REPO}" 2>&1 >/dev/null); then
  case "${ecr_err}" in
    *RepositoryNotFoundException*)
      echo "==> creating ECR repo ${ECR_REPO}"
      aws ecr create-repository --region "${AWS_REGION}" \
        --repository-name "${ECR_REPO}" \
        --image-scanning-configuration scanOnPush=true >/dev/null
      ;;
    *)
      echo "ERROR: cannot reach ECR repo ${ECR_REPO}: ${ecr_err}" >&2
      exit 1
      ;;
  esac
fi

# 4. Build and push. Always target linux/amd64 (the cluster nodes are amd64).
#    On CI (amd64 runner) this is a no-op; on an Apple Silicon Mac it prevents
#    pushing an arm64 image that would crash-loop with "exec format error".
echo "==> build + push"
docker build --platform linux/amd64 -t "${IMAGE}" .
docker push "${IMAGE}"

# 5. Render the manifests from the CONFIG block above and apply them. One sed
#    pass fills every placeholder, so all app-specific values come from CONFIG.
render() {
  sed \
    -e "s|__IMAGE__|${IMAGE}|g" \
    -e "s|__SECRET_HASH__|${SECRET_HASH}|g" \
    -e "s|__APP__|${APP_NAME}|g" \
    -e "s|__NAMESPACE__|${NAMESPACE}|g" \
    -e "s|__HOST__|${HOST}|g" \
    -e "s|__HEALTHCHECK_PATH__|${HEALTHCHECK_PATH}|g" \
    "$1"
}

echo "==> kubectl apply (ns=${NAMESPACE})"
for f in k8s/service.yaml k8s/ingress.yaml k8s/deployment.yaml; do
  render "$f" | kubectl -n "${NAMESPACE}" apply -f -
done

# 6. Wait for the rollout so the script fails loudly if the pod crashes.
#    300s gives a cold ECR pull room; a healthy warm rollout returns in seconds.
echo "==> rollout status"
kubectl -n "${NAMESPACE}" rollout status deploy/"${APP_NAME}" --timeout=300s

echo "==> done. https://${HOST}"
