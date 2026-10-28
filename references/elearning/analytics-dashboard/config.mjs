export const config = Object.freeze({
  kind: 'elearning',
  port: 9051,
  assets: [
    { id: 'EDU-FX-01', kind: 'lesson', en: 'Number line basics', ja: '数直線の基本' },
    { id: 'EDU-FX-02', kind: 'lesson', en: 'Number line exercises', ja: '数直線の演習' },
    { id: 'EDU-FX-03', kind: 'lesson', en: 'Review', ja: 'まとめ' },
  ],
  origins: ['catalog', 'playlist'],
});
