const contents = [
  "Не так быстро, сэр. До следующего лайка 3 часа 10 минут.",
  "You successfully liked the server.\nYou were faster than 96.07% users!",
  "Времени до\n<:DSMonitoring:972356183442718740> `/like`: Пора!",
  "Произошел сброс лайков",
  "Вы успешно лайкнули сервер.\nВы были быстрее, чем 0.00% пользователей!"
];

function isLikeSuccess(text) {
  return /(успешно лайкнули|successfully liked|успешно лайкнуто)/i.test(text);
}

function isCooldown(text) {
  return /(не так быстро|not so fast|до следующего лайка|cooldown)/i.test(text);
}

function parseCooldownText(text) {
  const hoursMatch = text.match(/(\d+)\s*(час|hour)/i);
  const minutesMatch = text.match(/(\d+)\s*(минут|min)/i);
  const secondsMatch = text.match(/(\d+)\s*(секунд|sec)/i);
  
  let totalMs = 0;
  if (hoursMatch) totalMs += parseInt(hoursMatch[1]) * 60 * 60 * 1000;
  if (minutesMatch) totalMs += parseInt(minutesMatch[1]) * 60 * 1000;
  if (secondsMatch) totalMs += parseInt(secondsMatch[1]) * 1000;
  
  return totalMs;
}

contents.forEach(c => {
  console.log('---');
  console.log('Text:', c);
  console.log('Success:', isLikeSuccess(c));
  console.log('Cooldown:', isCooldown(c));
  console.log('Parsed cooldown ms:', parseCooldownText(c));
});
