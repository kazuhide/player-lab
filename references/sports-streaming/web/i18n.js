const japanese = navigator.language.toLowerCase().startsWith('ja');
const strings = {
  'Download handoff records': '引き継ぎ記録をダウンロード',
  'Picture in picture': 'ピクチャ・イン・ピクチャ',
  Controls: '操作画面',
  Standard: '標準',
  Delivery: '配信形式',
  Play: '再生',
  Pause: '一時停止',
  Seek: '再生位置',
  Speed: '再生速度',
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
  'Match centre': '試合中継',
  Events: '試合一覧',
  'Event video': '試合の映像',
  'Refresh status': '配信状況を更新',
  Watch: '映像を選ぶ',
  Sports: 'スポーツ用',
  'Select a video': '映像を選んでください',
  'Live edge': 'ライブの最新位置',
  'Return to live': 'ライブに戻る',
  'Return to saved DVR position': '元の視聴位置に戻る',
  'Continue in archive': 'アーカイブで続きを見る',
  'Automatically continue in the archive': 'アーカイブで続きを自動再生',
  Event: '試合',
  Archive: 'アーカイブ',
  scheduled: '開始前',
  live: 'ライブ',
  ended: '終了',
  cancelled: '中止',
  ready: '準備完了',
  processing: '準備中',
  'not ready': '未準備',
  failed: '失敗',
  clip: 'クリップ',
  archive: 'アーカイブ',
  'Event status unavailable. Refresh to retry.':
    '配信状況を取得できません。「配信状況を更新」で再確認できます。',
  'Checking event…': '配信状況を確認中…',
  'Loading video…': '映像を読み込み中…',
  'Saved position left the DVR window. Choose Live edge to continue.':
    '元の視聴位置は追いかけ再生の範囲外です。「ライブの最新位置」で視聴を再開できます。',
  'Playback or positioning failed. Retry or select another video.':
    '映像の再生または指定位置への移動に失敗しました。再試行するか、別の映像を選んでください。',
  'UTC mapping unavailable': '視聴時刻に対応するアーカイブ位置は不明です',
  'At archive end': '視聴位置はアーカイブの末尾です',
  'Invalid archive mapping': 'アーカイブの時刻対応表に誤りがあります',
  'Position outside the retained archive': 'この場面はアーカイブに含まれていません',
  'Select the archive under Watch to start from its beginning.':
    '「映像を選ぶ」でアーカイブを選ぶと最初から再生できます。',
  'Catalog unavailable. Start the media publisher and refresh status.':
    '試合一覧を取得できません。配信サーバーを起動し、配信状況を更新してください。'
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
