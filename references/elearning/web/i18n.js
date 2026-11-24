const japanese = navigator.language.toLowerCase().startsWith('ja');
const strings = {
  'Follow current line': '再生中の行を追う',
  'Picture in picture': 'ピクチャ・イン・ピクチャ',
  Controls: '操作画面',
  Standard: '標準',
  Delivery: '配信形式',
  Play: '再生',
  Pause: '一時停止',
  Seek: '再生位置',
  Speed: '再生速度',
  'Captions could not be loaded. Retry playback or return to the course.':
    '字幕を取得できませんでした。再生をやり直すか、コースに戻ってください。',
  Captions: '字幕',
  Off: 'オフ',
  English: '英語',
  Fullscreen: '全画面',
  'Retry playback': '再生をやり直す',
  Diagnostics: '診断ログ',
  'Set VITE_PUBLIC_PLAYER_LICENSE_KEY in .env.local and restart the app.':
    '.env.local に VITE_PUBLIC_PLAYER_LICENSE_KEY を設定し、アプリを再起動してください。',
  'Playback error': '再生エラー',
  Live: 'ライブ',
  behind: '遅れ',
  'Number lines': '数直線',
  Course: 'コース',
  Learner: '学習者',
  'Play next automatically': '次の教材を自動再生',
  'Caption source': '字幕の読み込み元',
  'External tracks': '外部字幕',
  'HLS manifest': 'HLSマニフェスト',
  Lessons: '教材一覧',
  'Reload course': 'コースを再読み込み',
  Learning: '学習用',
  'Select a lesson': '教材を選んでください',
  Resume: '続きから再生',
  'Resume at': '続きから再生',
  'Start over': '最初から再生',
  'Return to course': 'コースに戻る',
  'Previous lesson': '前の教材',
  'Next lesson': '次の教材',
  Transcript: '本文',
  Language: '本文の言語',
  Search: '検索',
  'This browser could not save the resume position.': 'このブラウザには再開位置を保存できませんでした。',
  'No transcript cues.': 'この教材には本文がありません。',
  'Transcript unavailable.': '本文を取得できませんでした。',
  'Continue this lesson or start over.': '続きから再生するか、最初から再生するか選んでください。',
  'Loading lesson…': '教材を読み込み中…',
  'The saved position is outside this lesson. Start over or return to the course.':
    '保存した位置が教材の範囲外です。最初から再生するか、コースに戻ってください。',
  'Playback unavailable. Check the media publisher and Player license, then retry.':
    '映像を再生できません。配信サーバーとPlayerライセンスを確認し、再度お試しください。',
  'Lesson finished.': '教材の再生が終わりました。',
  'Loading course…': 'コースを読み込み中…',
  'Course unavailable. Start the media publisher and reload the course.':
    'コースを取得できません。配信サーバーを起動し、コースを再読み込みしてください。'
};
export const locale = japanese ? 'ja' : 'en';
export const t = (key) => (japanese ? (strings[key] ?? key) : key);
export const titleOf = (item) => (japanese && item.titleJa ? item.titleJa : item.title);
document.documentElement.lang = locale;
if (japanese) {
  document.title = t(document.title);
  const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const label = node.textContent.trim();
    if (strings[label]) node.textContent = node.textContent.replace(label, strings[label]);
  }
  for (const node of document.querySelectorAll('[aria-label]'))
    node.setAttribute('aria-label', t(node.getAttribute('aria-label')));
}
