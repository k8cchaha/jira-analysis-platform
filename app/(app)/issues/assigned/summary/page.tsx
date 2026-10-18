import { ComingSoon } from "@/components/coming-soon"

export default function Page() {
  return (
    <ComingSoon
      title="指派 Issue 摘要"
      description="彙整目前指派給你的未完成 Jira Issues。"
      breadcrumbs={["Issue 管理", "指派給我的 Issues", "摘要"]}
      plannedCapabilities={[
        "依狀態彙整未完成 Issues",
        "呈現個人工作量與到期狀況",
        "沿用指派 Issue 的共用篩選條件",
      ]}
      relatedLinks={[
        {
          href: "/issues/assigned/list",
          label: "查看目前可用的指派 Issue 清單",
        },
      ]}
    />
  )
}
