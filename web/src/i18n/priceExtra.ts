// [PRICE] Strings for menu prices + the shared currency/exchange-rate line.
// Amounts themselves are formatted by Intl.NumberFormat (lib/money.ts).
import type { Lang } from '../types';

export const priceExtra: Record<Lang, Record<string, string>> = {
  en: {
    currencyLabel: 'Show prices in',
    currencySuggested: '(suggested from your country)',
    convertedNote: 'Converted amounts are approximate, for reference only. Pay the price on the menu.',
    fxLiveDaily: 'Rate updated daily · as of {time}',
    priceAmbiguous: 'Price unclear on the menu: “{text}”',
    priceNotShown: 'No price shown on the menu for this dish.',
    priceFromMenu: 'Price as printed on the menu',
  },
  ja: {
    currencyLabel: '価格の表示通貨',
    currencySuggested: '（国から推奨）',
    convertedNote: '換算額はおおよその参考値です。支払いはメニュー記載の価格です。',
    fxLiveDaily: 'レートは1日1回更新 · {time} 時点',
    priceAmbiguous: 'メニューの価格が不明確です：「{text}」',
    priceNotShown: 'この料理の価格はメニューに表示されていません。',
    priceFromMenu: 'メニューに記載された価格',
  },
  zh: {
    currencyLabel: '价格显示币种',
    currencySuggested: '（根据国家推荐）',
    convertedNote: '换算金额为近似值，仅供参考。请按菜单上的价格付款。',
    fxLiveDaily: '汇率每日更新 · 截至 {time}',
    priceAmbiguous: '菜单上的价格不明确：“{text}”',
    priceNotShown: '菜单上没有标出这道菜的价格。',
    priceFromMenu: '菜单上标注的价格',
  },
  vi: {
    currencyLabel: 'Hiển thị giá bằng',
    currencySuggested: '(gợi ý theo quốc gia)',
    convertedNote: 'Số tiền quy đổi chỉ là ước tính để tham khảo. Hãy thanh toán theo giá trên thực đơn.',
    fxLiveDaily: 'Tỷ giá cập nhật hằng ngày · lúc {time}',
    priceAmbiguous: 'Giá trên thực đơn không rõ: “{text}”',
    priceNotShown: 'Thực đơn không ghi giá cho món này.',
    priceFromMenu: 'Giá in trên thực đơn',
  },
  es: {
    currencyLabel: 'Mostrar precios en',
    currencySuggested: '(sugerido según tu país)',
    convertedNote: 'Los importes convertidos son aproximados y solo de referencia. Se paga el precio del menú.',
    fxLiveDaily: 'Tipo actualizado a diario · a las {time}',
    priceAmbiguous: 'Precio poco claro en el menú: «{text}»',
    priceNotShown: 'El menú no muestra precio para este plato.',
    priceFromMenu: 'Precio impreso en el menú',
  },
  ko: {
    currencyLabel: '가격 표시 통화',
    currencySuggested: '(국가 기준 추천)',
    convertedNote: '환산 금액은 참고용 근삿값입니다. 결제는 메뉴판 가격 기준입니다.',
    fxLiveDaily: '환율 일 1회 갱신 · {time} 기준',
    priceAmbiguous: '메뉴판 가격이 불명확합니다: “{text}”',
    priceNotShown: '메뉴판에 이 음식의 가격이 표시되어 있지 않습니다.',
    priceFromMenu: '메뉴판에 적힌 가격',
  },
};
