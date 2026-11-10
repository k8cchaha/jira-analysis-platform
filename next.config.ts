import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
