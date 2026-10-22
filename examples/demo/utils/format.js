// 金额一律以「分」的整数存储，只有这里把分转成 ¥12.30 这种展示形式。
function money(fen) {
  const rounded = Math.round(fen)
  const yuan = Math.floor(rounded / 100)
  const cents = rounded % 100
  return '¥' + yuan + '.' + (cents < 10 ? '0' + cents : String(cents))
}

module.exports = { money }
