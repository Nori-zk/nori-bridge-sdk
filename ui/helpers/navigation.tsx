export const openExternalLink = (url: string) => {
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

export const navigateToExternal = (url: string) => {
  if (typeof window !== "undefined") {
    window.location.href = url;
  }
};
