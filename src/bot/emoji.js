const EMOJIS = {
  smile: '5943026932730831098',
  gear: '5938478021198484505',
  paperclip: '5938527147034415069',
  chat: '5938359183748370657',
  link: '5936181055508713274',
  stats: '5938517659451658781',
  eye: '5800697136790116460',
  cross: '5938302546014638461',
  globe: '5938398023137628324',
  book: '5938024562846340196',
  green: '5938325219146993806',
  stop: '5938093595855688024',
  up: '5938558852482994666',
  down: '5937997208199631548',
  trash: '5935949943318516172',
  plus: '5940582340425159463',
  back: '5814508007857328957',
  broadcast: '5935848131118764667',
  video: '5938028235043377686',
  gif: '5940430530511114301',
  audio: '5938483050605187354',
  sparkle: '5938348905891632091',
  info: '5938227611720225823',
  calendar: '5938187775898556145',
  warn: '5938167138580741203',
  check: '5938109560249127910',
  star: '5938116638355231267',
  crown: '5935933089866846598',
  fire: '5938264290740933445',
  money: '5938026800524301051',
};

function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? [...s].slice(0, max).join('') + '…' : s;
}

function stripHtml(text) {
  return String(text ?? '')
    .replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

module.exports = { EMOJIS, escapeHtml, truncate, stripHtml };
