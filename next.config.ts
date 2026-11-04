import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects() {
    // 精確相容既有分析子頁；新入口不含 view segment，query values 由 Next 原樣傳遞。
    return [
      { source: "/analytics/workload/summary", destination: "/analytics/workload", permanent: false },
      { source: "/analytics/workload/breakdown", destination: "/analytics/workload", permanent: false },
      { source: "/analytics/workload/detail", destination: "/analytics/workload", permanent: false },
      { source: "/analytics/projects/summary", destination: "/analytics/projects", permanent: false },
      { source: "/analytics/story-points/summary", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/story-points/distribution", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/story-points/detail", destination: "/analytics/story-points", permanent: false },
      { source: "/analytics/members/summary", destination: "/analytics/members", permanent: false },
      { source: "/analytics/members/comparison", destination: "/analytics/members", permanent: false },
      { source: "/analytics/members/detail", destination: "/analytics/members", permanent: false },
      { source: "/analytics/trends/summary", destination: "/analytics/trends", permanent: false },
      { source: "/analytics/trends/comparison", destination: "/analytics/trends", permanent: false },
      { source: "/analytics/trends/detail", destination: "/analytics/trends", permanent: false },
      { source: "/analytics/comparison/summary", destination: "/analytics/comparison", permanent: false },
    ]
  },
};

export default nextConfig;
