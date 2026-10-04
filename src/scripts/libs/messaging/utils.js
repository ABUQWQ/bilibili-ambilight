export const origin = 'https://www.bilibili.com';
export const extensionId = 'bilibili-ambient-light-extension';

export const isSameWindowMessage = (event) =>
  event.source === window && event.origin === origin;
