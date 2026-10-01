export function assessmentVideoEmbed(url: string): string | null {
  try {
    const parsed = new URL(url);
    const id =
      parsed.hostname === "youtu.be"
        ? parsed.pathname.slice(1)
        : ["www.youtube.com", "youtube.com"].includes(parsed.hostname)
          ? parsed.searchParams.get("v")
          : null;
    return id && /^[\w-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}
