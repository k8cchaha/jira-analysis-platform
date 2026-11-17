import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 容器部署（deploy.sh / Dockerfile）只帶 .next/standalone，不在 image 內安裝 node_modules。
  output: "standalone",
  experimental: {
    // Production 由站點網域服務，但容器內 request.url 的 origin 是打到本身的 http://<pod>:8080，
    // 因此任何 origin 比對都會誤判。Next 自身可接受的來源清單併同 X-Forwarded-Host 一起當作
    // 本站來源（只認 HTTP Host／X-Forwarded 標頭，不信任 X-Forwarded-For）。
    // 由部署環境提供，例如 AUTH_URL="https://jira-analysis.example.com"。
    serverActions: { allowedOrigins: process.env.AUTH_URL ? [new URL(process.env.AUTH_URL).host] : [] },
  },
  redirects() {
    // 精確相容既有分析網址；趨勢／比較直接轉入專案回顧與趨勢，query values 由 Next 原樣傳遞。
    return [
      { source: "/analytics/workload/summary", destination: "/analytics/workload", permanent: false },
      { source: "/analytics/workload/breakdown", destination: "/analytics/workload", permanent: false },
      { source: "/analytics/workload/detail", destination: "/analytics/workload", permanent: false },
      { source: "/analytics/projects/summary", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/story-points/summary", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/story-points/distribution", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/story-points/detail", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/members/summary", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/members/comparison", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/members/detail", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/trends/summary", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/trends/comparison", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/trends/detail", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/comparison/summary", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/trends", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/comparison", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/members", destination: "/analytics/story-points", permanent: false },
    ]
  },
};

export default nextConfig;
