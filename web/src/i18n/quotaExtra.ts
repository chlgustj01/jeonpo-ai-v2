// [QUOTA] Messages for the three Gemini quota cases + the retry time.
// {time} is a relative time from Intl.RelativeTimeFormat ("in 6 hours",
// "6時間後", "6시간 후" …) or the word for "later" when the server gave no time.
import type { Lang } from '../types';

export const quotaExtra: Record<Lang, Record<string, string>> = {
  en: {
    errAiQuotaDaily: "Today's free AI analysis limit has been reached. You can analyze again {time}. The map, exchange rates, your profile and reviews still work.",
    errAiQuotaMinute: 'Too many analysis requests in a short time. You can try again {time}.',
    errAiQuotaTokens: 'This photo needs more AI capacity than is available right now. Try again {time}, or photograph a smaller part of the menu.',
    retryAvailableIn: 'Try again {time}',
    timeLater: 'later',
    translationQuotaNotice: "Today's translation limit has been reached — showing the original English text.",
  },
  ja: {
    errAiQuotaDaily: '本日の無料AI分析の上限に達しました。{time}に再度分析できます。地図・為替・プロフィール・レビューは引き続き使えます。',
    errAiQuotaMinute: '短時間に分析リクエストが集中しました。{time}に再試行できます。',
    errAiQuotaTokens: 'この写真には現在利用できる以上のAI処理量が必要です。{time}に再試行するか、メニューの一部を撮影してください。',
    retryAvailableIn: '{time}に再試行',
    timeLater: 'しばらくして',
    translationQuotaNotice: '本日の翻訳の上限に達しました — 英語の原文を表示しています。',
  },
  zh: {
    errAiQuotaDaily: '今日免费 AI 分析次数已用完。可在{time}再次分析。地图、汇率、档案和评价仍可正常使用。',
    errAiQuotaMinute: '短时间内分析请求过多。可在{time}重试。',
    errAiQuotaTokens: '这张照片所需的 AI 处理量超出当前可用范围。请在{time}重试，或拍摄菜单的一部分。',
    retryAvailableIn: '{time}可重试',
    timeLater: '稍后',
    translationQuotaNotice: '今日翻译次数已用完 — 正在显示英文原文。',
  },
  vi: {
    errAiQuotaDaily: 'Đã hết lượt phân tích AI miễn phí hôm nay. Bạn có thể phân tích lại {time}. Bản đồ, tỷ giá, hồ sơ và đánh giá vẫn dùng được.',
    errAiQuotaMinute: 'Có quá nhiều yêu cầu phân tích trong thời gian ngắn. Bạn có thể thử lại {time}.',
    errAiQuotaTokens: 'Ảnh này cần nhiều năng lực AI hơn mức hiện có. Hãy thử lại {time}, hoặc chụp một phần nhỏ hơn của thực đơn.',
    retryAvailableIn: 'Thử lại {time}',
    timeLater: 'sau',
    translationQuotaNotice: 'Đã hết lượt dịch hôm nay — đang hiển thị bản tiếng Anh gốc.',
  },
  es: {
    errAiQuotaDaily: 'Se alcanzó el límite diario gratuito de análisis con IA. Podrás analizar de nuevo {time}. El mapa, el cambio de divisas, tu perfil y las reseñas siguen funcionando.',
    errAiQuotaMinute: 'Demasiadas solicitudes de análisis en poco tiempo. Podrás intentarlo de nuevo {time}.',
    errAiQuotaTokens: 'Esta foto necesita más capacidad de IA de la disponible ahora. Inténtalo de nuevo {time} o fotografía una parte más pequeña del menú.',
    retryAvailableIn: 'Reintentar {time}',
    timeLater: 'más tarde',
    translationQuotaNotice: 'Se alcanzó el límite diario de traducción — se muestra el texto original en inglés.',
  },
  ko: {
    errAiQuotaDaily: '오늘 무료 AI 분석 한도에 도달했습니다. {time} 다시 분석할 수 있습니다. 지도·환율·프로필·리뷰는 계속 사용할 수 있습니다.',
    errAiQuotaMinute: '짧은 시간에 분석 요청이 많았습니다. {time} 다시 시도할 수 있습니다.',
    errAiQuotaTokens: '이 사진은 지금 사용할 수 있는 AI 처리량보다 많은 처리가 필요합니다. {time} 다시 시도하거나 메뉴판 일부만 촬영해 주세요.',
    retryAvailableIn: '{time} 다시 시도',
    timeLater: '잠시 후',
    translationQuotaNotice: '오늘 번역 한도에 도달해 영어 원문을 표시합니다.',
  },
};

const LOCALE: Record<Lang, string> = { en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', vi: 'vi-VN', es: 'es-ES', ko: 'ko-KR' };

// Seconds until retry -> localized relative time. >= 2h in hours (rounded up),
// >= 90s in minutes (rounded up), else seconds.
export function formatRetryTime(lang: Lang, seconds: number | null | undefined, laterWord: string): string {
  if (!seconds || seconds <= 0) return laterWord;
  try {
    const rtf = new Intl.RelativeTimeFormat(LOCALE[lang] || 'en-US', { numeric: 'always' });
    if (seconds >= 7200) return rtf.format(Math.ceil(seconds / 3600), 'hour');
    if (seconds >= 90) return rtf.format(Math.ceil(seconds / 60), 'minute');
    return rtf.format(Math.ceil(seconds), 'second');
  } catch {
    return laterWord;
  }
}
