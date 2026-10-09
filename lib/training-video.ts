const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function normalizeYouTubeVideoId(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return YOUTUBE_VIDEO_ID.test(normalized) ? normalized : "";
}

export function trainingVideoErrorMessage(code?: number) {
  if (code === 100)
    return "Видео этого урока удалено или закрыто владельцем. Сообщите директору.";
  if (code === 101 || code === 150)
    return "Владелец видео запретил просмотр внутри ORDA. Сообщите директору.";
  return "Видео этого урока временно недоступно. Повторите попытку или сообщите директору.";
}
