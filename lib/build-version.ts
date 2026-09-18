const configuredBuildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION?.trim();

export const BUILD_VERSION = configuredBuildVersion || "dev";
export const BUILD_VERSION_LABEL = BUILD_VERSION === "dev"
  ? "開發版"
  : `${BUILD_VERSION}（台灣時間）`;
