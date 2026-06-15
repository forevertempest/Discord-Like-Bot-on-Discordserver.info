const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const db = new sqlite3.Database(path.join(__dirname, 'tokens.db'));

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS token_usage (token TEXT PRIMARY KEY, last_used INTEGER)");
  const stmt = db.prepare("INSERT OR IGNORE INTO token_usage (token, last_used) VALUES (?, 0)");
  for (const token of config.tokens) {
    stmt.run(token);
  }
  stmt.finalize();
});

function getTokensToUse(count) {
  return new Promise((resolve, reject) => {
    db.all("SELECT token FROM token_usage ORDER BY last_used ASC LIMIT ?", [count], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.token));
    });
  });
}

function updateTokenUsage(tokens) {
  return new Promise((resolve, reject) => {
    if (!tokens || tokens.length === 0) return resolve();
    const now = Date.now();
    const placeholders = tokens.map(() => '?').join(',');
    db.run(`UPDATE token_usage SET last_used = ? WHERE token IN (${placeholders})`, [now, ...tokens], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

const MSK_OFFSET = 3 * 60 * 60 * 1000;

let resetLikeInProgress = false;

let activeClients = [];
function getMoscowTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + MSK_OFFSET);
}
async function preciseWait(targetTimeMs, pingOffsetMs = 0) {
  const effectiveTarget = targetTimeMs - pingOffsetMs;

  const remaining = effectiveTarget - Date.now();
  if (remaining <= 0) return;

  if (remaining > 10) {
    await new Promise(resolve => setTimeout(resolve, remaining - 10));
  }

  while (Date.now() < effectiveTarget) {
  }
}
async function calculateDynamicPing(client) {
  try {
    let total = 0;
    const pings = 3;
    console.log(`[PING] Measuring dynamic REST latency...`);
    for (let i = 0; i < pings; i++) {
      const start = Date.now();
      await client.users.fetch(client.user.id, { force: true });
      total += (Date.now() - start);
    }
    const avg = Math.floor(total / pings);
    console.log(`[PING] Measured average REST latency: ${avg}ms`);
    return avg;
  } catch (e) {
    console.log(`[PING] Failed to measure dynamic ping, falling back to config offset. Error: ${e.message}`);
    return config.pingOffsetMs || 100;
  }
}

const SCHEDULED_DAYS = [1, 15];
const SCHEDULED_HOUR = 3;
const SCHEDULED_MINUTE = 0;
const SCHEDULED_SECOND = 0;
const SCHEDULED_MS = 10;
function checkIfScheduledLikeDay(timestamp) {
  const targetDate = new Date(timestamp * 1000);
  const utc = targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000);
  const targetMsk = new Date(utc + MSK_OFFSET);

  const targetDay = targetMsk.getDate();
  const targetHour = targetMsk.getHours();

  console.log(`[SCHEDULED CHECK] Target time in MSK: ${targetMsk.toLocaleString('ru-RU')} (day ${targetDay}, hour ${targetHour})`);

  if (SCHEDULED_DAYS.includes(targetDay) && targetHour < SCHEDULED_HOUR) {
    const scheduledMsk = new Date(targetMsk);
    scheduledMsk.setHours(SCHEDULED_HOUR, SCHEDULED_MINUTE, SCHEDULED_SECOND, SCHEDULED_MS);

    const nowMsk = getMoscowTime();
    const waitMs = scheduledMsk.getTime() - nowMsk.getTime();
    const scheduledLocal = new Date(Date.now() + waitMs);

    console.log(`[SCHEDULED CHECK] Target time ${targetMsk.toLocaleString('ru-RU')} MSK is on day ${targetDay} before 3:00 AM MSK`);
    console.log(`[SCHEDULED CHECK] Will wait until scheduled time: ${scheduledMsk.toLocaleString('ru-RU')} MSK`);

    return { scheduledTime: scheduledLocal, mskTime: scheduledMsk };
  }

  return null;
}
function extractTimestamp(embed) {
  const title = embed?.title || '';
  const description = embed?.description || '';
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  const fieldsText = fields
    .map(field => `${field?.name || ''} ${field?.value || ''}`.trim())
    .join('\n');

  const content = [title, description, fieldsText].filter(Boolean).join('\n');

  if (/(пора!?|it['’]?s\s+time!?)/i.test(content)) {
    return null;
  }

  const timestampMatch = content.match(/<t:(\d+):[A-Za-z]>/) || content.match(/<t:(\d+):/);
  if (timestampMatch) {
    return parseInt(timestampMatch[1], 10);
  }

  return undefined;
}
function isLikesReset(embed) {
  const title = embed.title || '';
  const description = embed.description || '';
  return title.includes('Произошел сброс лайков') || description.includes('Произошел сброс лайков');
}
function isLikeSuccess(embed) {
  const title = embed.title || '';
  const description = embed.description || '';
  const content = title + '\n' + description;
  return /(успешно лайкнули|успешно лайкнуто|successfully liked)/i.test(content);
}
function isCooldown(embed) {
  const title = embed?.title || '';
  const description = embed?.description || '';
  const content = title + '\n' + description;
  return /(не так быстро|not so fast|до следующего лайка|cooldown)/i.test(content);
}
function parseCooldownMs(embed) {
  const title = embed?.title || '';
  const description = embed?.description || '';
  const content = title + '\n' + description;
  
  const hoursMatch = content.match(/(\d+)\s*(час|hour)/i);
  const minutesMatch = content.match(/(\d+)\s*(минут|min)/i);
  const secondsMatch = content.match(/(\d+)\s*(секунд|sec)/i);
  
  let totalMs = 0;
  if (hoursMatch) totalMs += parseInt(hoursMatch[1], 10) * 60 * 60 * 1000;
  if (minutesMatch) totalMs += parseInt(minutesMatch[1], 10) * 60 * 1000;
  if (secondsMatch) totalMs += parseInt(secondsMatch[1], 10) * 1000;
  
  return totalMs;
}
async function executeLikeCommandUntilSuccess(clients, logPrefix = '[LIKE]', allowCooldownReturn = false) {
  const channelId = config.channelId;
  let success = false;

  while (!success) {
    console.log(`${logPrefix} Sending /like command simultaneously across ${clients.length} tokens...`);
    
    const responses = await Promise.allSettled(clients.map(async client => {
      return await sendSlashCommand(
        client,
        channelId,
        config.likeCommand.botId,
        config.likeCommand.commandId,
        config.likeCommand.versionId,
        config.likeCommand.commandName
      );
    }));

    await new Promise(resolve => setTimeout(resolve, 3000));

    let anySuccess = false;
    let minCooldown = Infinity;
    let fallbackFormatError = false;

    for (const result of responses) {
      if (result.status === 'fulfilled' && result.value && result.value.embeds && result.value.embeds.length > 0) {
        const likeEmbed = result.value.embeds[0];
        if (isLikeSuccess(likeEmbed)) {
          anySuccess = true;
          console.log(`${logPrefix} Like successful on one of the tokens!`);
          const fields = likeEmbed.fields || [];
          console.log(`${logPrefix} Title: ${likeEmbed.title || 'N/A'}`);
          for (const field of fields) {
            console.log(`${logPrefix} ${field.name}: ${field.value}`);
          }
          break;
        } else if (isCooldown(likeEmbed)) {
          const cooldownMs = parseCooldownMs(likeEmbed);
          if (cooldownMs > 0 && cooldownMs < minCooldown) {
             minCooldown = cooldownMs;
          }
        } else {
          fallbackFormatError = true;
        }
      }
    }

    if (anySuccess) {
      return { status: 'success' };
    } else if (minCooldown !== Infinity) {
      console.log(`${logPrefix} All requests received cooldown messages.`);
      if (allowCooldownReturn) {
        console.log(`${logPrefix} Returning minimum parsed cooldown: ${Math.floor(minCooldown / 1000)} seconds.`);
        return { status: 'cooldown', cooldownMs: minCooldown };
      }
      console.log(`${logPrefix} Waiting 30 seconds before retrying...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
    } else {
      if (fallbackFormatError) {
        console.log(`${logPrefix} Unknown embed format, retrying in 30 seconds...`);
      } else {
        console.log(`${logPrefix} No embeds or all failed, retrying in 30 seconds...`);
      }
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}
async function sendSlashCommand(client, channelId, botId, commandId, versionId, commandName) {
  try {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);

    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const response = await channel.sendSlash(botId, commandName, commandId, versionId);
    return response;
  } catch (error) {
    console.error(`[ERROR] Failed to send /${commandName}:`, error.message);
    throw error;
  }
}
async function handleLikesReset() {
  if (resetLikeInProgress) {
    console.log('[RESET] Reset like already in progress, skipping...');
    return;
  }
  if (!activeClients || activeClients.length === 0) return;

  resetLikeInProgress = true;
  const channelId = config.channelId;

  try {
    console.log('[RESET DETECTED] Likes have been reset! Sending /like immediately...');
    console.log(`[RESET] Moscow time: ${getMoscowTime().toLocaleString('ru-RU')}`);

    await executeLikeCommandUntilSuccess(activeClients, '[RESET SUCCESS]', false);

    console.log('[RESET] Now checking /remaining for next like time...');

    const remainingResponse = await sendSlashCommand(
      activeClients[0],
      channelId,
      config.remainingCommand.botId,
      config.remainingCommand.commandId,
      config.remainingCommand.versionId,
      config.remainingCommand.commandName
    );

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (remainingResponse && remainingResponse.embeds && remainingResponse.embeds.length > 0) {
      const embed = remainingResponse.embeds[0];
      const nextTimestamp = extractTimestamp(embed);

      if (typeof nextTimestamp === 'number') {
        console.log(`[RESET] Next like at: ${new Date(nextTimestamp * 1000).toLocaleString()}`);
      } else if (nextTimestamp === null) {
        console.log('[RESET] /remaining reports: Пора!');
      } else {
        console.log('[RESET] /remaining embed format not recognized');
        console.log(`[RESET] Title: ${embed.title || 'N/A'}`);
        console.log(`[RESET] Description: ${embed.description || 'N/A'}`);
      }
    }
  } catch (error) {
    console.error('[RESET ERROR]', error.message);
  } finally {
    resetLikeInProgress = false;
  }
}
function isLikeReminder(message) {
  const content = message.content || '';
  return content.includes('<@&') && content.includes('`/like`');
}
async function handleLikeReminder() {
  if (resetLikeInProgress) {
    console.log('[REMINDER] Like already in progress, skipping...');
    return;
  }
  if (!activeClients || activeClients.length === 0) return;

  resetLikeInProgress = true;
  const channelId = config.channelId;

  try {
    console.log('[REMINDER DETECTED] Like reminder received! Sending /like immediately...');
    console.log(`[REMINDER] Moscow time: ${getMoscowTime().toLocaleString('ru-RU')}`);

    await executeLikeCommandUntilSuccess(activeClients, '[REMINDER SUCCESS]', false);

    console.log('[REMINDER] Now checking /remaining for next like time...');

    const remainingResponse = await sendSlashCommand(
      activeClients[0],
      channelId,
      config.remainingCommand.botId,
      config.remainingCommand.commandId,
      config.remainingCommand.versionId,
      config.remainingCommand.commandName
    );

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (remainingResponse && remainingResponse.embeds && remainingResponse.embeds.length > 0) {
      const embed = remainingResponse.embeds[0];
      const nextTimestamp = extractTimestamp(embed);

      if (typeof nextTimestamp === 'number') {
        console.log(`[REMINDER] Next like at: ${new Date(nextTimestamp * 1000).toLocaleString()}`);
      } else if (nextTimestamp === null) {
        console.log('[REMINDER] /remaining reports: Пора!');
      } else {
        console.log('[REMINDER] /remaining embed format not recognized');
        console.log(`[REMINDER] Title: ${embed.title || 'N/A'}`);
        console.log(`[REMINDER] Description: ${embed.description || 'N/A'}`);
      }
    }
  } catch (error) {
    console.error('[REMINDER ERROR]', error.message);
  } finally {
    resetLikeInProgress = false;
  }
}
function setupResetListener(client) {
  client.on('messageCreate', async (message) => {
    if (message.channel.id !== config.channelId) return;

    if (isLikeReminder(message)) {
      console.log('[LISTENER] Detected like reminder message in channel!');
      console.log(`[LISTENER] Message content: ${message.content}`);
      await handleLikeReminder();
      return;
    }

    if (message.embeds && message.embeds.length > 0) {
      for (const embed of message.embeds) {
        if (isLikesReset(embed)) {
          console.log('[LISTENER] Detected likes reset message in channel!');
          await handleLikesReset();
          return;
        }
      }
    }
  });

  console.log(`[LISTENER] Reset and reminder listener active for channel ${config.channelId}`);
}
async function performLikeCycle(clients) {
  if (!clients || clients.length === 0) throw new Error('No active clients provided to performLikeCycle');
  const channelId = config.channelId;

  try {
    console.log(`[${new Date().toLocaleString()}] Checking remaining time...`);

    const remainingResponse = await sendSlashCommand(
      clients[0],
      channelId,
      config.remainingCommand.botId,
      config.remainingCommand.commandId,
      config.remainingCommand.versionId,
      config.remainingCommand.commandName
    );

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (!remainingResponse || !remainingResponse.embeds || remainingResponse.embeds.length === 0) {
      throw new Error('No embed received from /remaining command');
    }

    const embed = remainingResponse.embeds[0];
    console.log(`[INFO] Embed title: ${embed.title || 'N/A'}`);
    console.log(`[INFO] Embed description: ${embed.description || 'N/A'}`);

    const targetTimestamp = extractTimestamp(embed);

    if (typeof targetTimestamp === 'undefined') {
      throw new Error('Could not parse /remaining embed timestamp');
    }

    if (targetTimestamp === null) {
      console.log('[ACTION] Time is ready! Sending /like command now...');

      const likeAction = await executeLikeCommandUntilSuccess(clients, '[SUCCESS]', true);

      if (likeAction.status === 'cooldown') {
        console.log(`[COOLDOWN] Applying cooldown fallback of ${Math.floor(likeAction.cooldownMs / 1000)} seconds.`);
        let waitTime = likeAction.cooldownMs;
        if (config.testMode && waitTime > (config.testWaitSeconds || 30) * 1000) {
          console.log(`[TEST MODE] Reducing wait time from ${Math.floor(waitTime / 1000)}s to ${config.testWaitSeconds || 30}s`);
          waitTime = (config.testWaitSeconds || 30) * 1000;
        }
        return { status: 'wait', waitTime: waitTime };
      }

      let verified = false;
      while (!verified) {
        console.log('[VERIFY] Checking if /like was successful...');

        const verifyResponse = await sendSlashCommand(
          clients[0],
          channelId,
          config.remainingCommand.botId,
          config.remainingCommand.commandId,
          config.remainingCommand.versionId,
          config.remainingCommand.commandName
        );

        await new Promise(resolve => setTimeout(resolve, 2000));

        if (verifyResponse && verifyResponse.embeds && verifyResponse.embeds.length > 0) {
          const verifyEmbed = verifyResponse.embeds[0];
          const verifyTimestamp = extractTimestamp(verifyEmbed);

          if (typeof verifyTimestamp === 'number') {
            console.log(`[SUCCESS] /like command verified! Next time: ${new Date(verifyTimestamp * 1000).toLocaleString()}`);
            verified = true;

            const scheduledCheck = checkIfScheduledLikeDay(verifyTimestamp);

            let targetTimeMs;
            if (scheduledCheck) {
              targetTimeMs = scheduledCheck.scheduledTime.getTime();
              console.log(`[SCHEDULED] Next like falls on scheduled day before 3 AM`);
              console.log(`[SCHEDULED] Will wait for scheduled like at: ${scheduledCheck.scheduledTime.toLocaleString()}`);
            } else {
              targetTimeMs = verifyTimestamp * 1000;
            }

            let waitTime = targetTimeMs - Date.now();

            if (config.testMode && waitTime > (config.testWaitSeconds || 30) * 1000) {
              console.log(`[TEST MODE] Reducing wait time from ${Math.floor(waitTime / 1000)}s to ${config.testWaitSeconds || 30}s`);
              waitTime = (config.testWaitSeconds || 30) * 1000;
              targetTimeMs = Date.now() + waitTime;
            }

            if (waitTime > 30000) {
              console.log(`[WAIT] Next /like is in ${Math.floor(waitTime / 1000)} seconds. Returning to wait...`);
              return { status: 'wait', waitTime: waitTime };
            }

            if (waitTime > 0) {
              let pingMs = config.pingOffsetMs || 100;
              if (waitTime > 2000) {
                pingMs = await calculateDynamicPing(clients[0]);
              }
              console.log(`[WAIT] Precise waiting ${waitTime} ms until next /like... (Ping offset: ${pingMs}ms)`);
              await preciseWait(targetTimeMs, pingMs);
            }

            return { status: 'success' };
          } else if (verifyTimestamp === null) {
            console.log('[RETRY] /like command failed verification, retrying...');

            const retryAction = await executeLikeCommandUntilSuccess(clients, '[RETRY]', true);
            if (retryAction.status === 'cooldown') {
              console.log(`[COOLDOWN] Applying cooldown fallback of ${Math.floor(retryAction.cooldownMs / 1000)} seconds.`);
              let waitTime = retryAction.cooldownMs;
              if (config.testMode && waitTime > (config.testWaitSeconds || 30) * 1000) {
                waitTime = (config.testWaitSeconds || 30) * 1000;
              }
              return { status: 'wait', waitTime: waitTime };
            }
          } else {
            console.log('[RETRY] Verification embed format not recognized, waiting and checking again...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          console.log('[ERROR] No embed in verification response');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    } else {
      const scheduledCheck = checkIfScheduledLikeDay(targetTimestamp);

      let targetTimeMs;
      if (scheduledCheck) {
        targetTimeMs = scheduledCheck.scheduledTime.getTime();
        console.log(`[SCHEDULED] Next like falls on scheduled day before 3 AM`);
        console.log(`[SCHEDULED] Will wait for scheduled like at: ${scheduledCheck.scheduledTime.toLocaleString()}`);
      } else {
        targetTimeMs = targetTimestamp * 1000;
      }

      let waitTime = targetTimeMs - Date.now();

      if (config.testMode && waitTime > (config.testWaitSeconds || 30) * 1000) {
        console.log(`[TEST MODE] Reducing wait time from ${Math.floor(waitTime / 1000)}s to ${config.testWaitSeconds || 30}s`);
        waitTime = (config.testWaitSeconds || 30) * 1000;
        targetTimeMs = Date.now() + waitTime;
      }

      if (waitTime > 30000) {
        console.log(`[WAIT] Next /like is in ${Math.floor(waitTime / 1000)} seconds. Returning to wait...`);
        return { status: 'wait', waitTime: waitTime };
      }

      if (waitTime > 0) {
        let pingMs = config.pingOffsetMs || 100;
        if (waitTime > 2000) {
          pingMs = await calculateDynamicPing(clients[0]);
        }
        console.log(`[WAIT] Next /like command at: ${new Date(targetTimeMs).toLocaleString()}`);
        console.log(`[WAIT] Precise waiting ${waitTime} ms... (Ping offset: ${pingMs}ms)`);
        await preciseWait(targetTimeMs, pingMs);
      } else {
        console.log('[ACTION] Target time already reached, sending /like immediately...');
      }

      console.log('[ACTION] Time reached! Sending /like command...');

      const likeAction = await executeLikeCommandUntilSuccess(clients, '[SUCCESS]', true);

      if (likeAction.status === 'cooldown') {
        console.log(`[COOLDOWN] Applying cooldown fallback of ${Math.floor(likeAction.cooldownMs / 1000)} seconds.`);
        let waitTime = likeAction.cooldownMs;
        if (config.testMode && waitTime > (config.testWaitSeconds || 30) * 1000) {
          console.log(`[TEST MODE] Reducing wait time from ${Math.floor(waitTime / 1000)}s to ${config.testWaitSeconds || 30}s`);
          waitTime = (config.testWaitSeconds || 30) * 1000;
        }
        return { status: 'wait', waitTime: waitTime };
      }

      let verified = false;
      while (!verified) {
        console.log('[VERIFY] Checking if /like was successful...');

        const verifyResponse = await sendSlashCommand(
          clients[0],
          channelId,
          config.remainingCommand.botId,
          config.remainingCommand.commandId,
          config.remainingCommand.versionId,
          config.remainingCommand.commandName
        );

        await new Promise(resolve => setTimeout(resolve, 2000));

        if (verifyResponse && verifyResponse.embeds && verifyResponse.embeds.length > 0) {
          const verifyEmbed = verifyResponse.embeds[0];
          const verifyTimestamp = extractTimestamp(verifyEmbed);

          if (typeof verifyTimestamp === 'number') {
            console.log(`[SUCCESS] /like command verified! Next time: ${new Date(verifyTimestamp * 1000).toLocaleString()}`);
            verified = true;
            return { status: 'success' };
          } else if (verifyTimestamp === null) {
            console.log('[RETRY] /like command failed verification, retrying...');

            const retryAction = await executeLikeCommandUntilSuccess(clients, '[RETRY]', true);
            if (retryAction.status === 'cooldown') {
              console.log(`[COOLDOWN] Applying cooldown fallback of ${Math.floor(retryAction.cooldownMs / 1000)} seconds.`);
              let waitTime = retryAction.cooldownMs;
              if (config.testMode && waitTime > (config.testWaitSeconds || 30) * 1000) {
                waitTime = (config.testWaitSeconds || 30) * 1000;
              }
              return { status: 'wait', waitTime: waitTime };
            }
          } else {
            console.log('[RETRY] Verification embed format not recognized, waiting and checking again...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          console.log('[ERROR] No embed in verification response');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

  } catch (error) {
    console.error('[ERROR]', error.message);
    throw error;
  }
}
async function createAndLoginClient(token) {
  const client = new Client({
    checkUpdate: false,
    readyStatus: false,
    ws: {
      properties: {
        $browser: 'Discord Client'
      }
    }
  });

  client.on('error', (error) => {
    console.error('[CLIENT ERROR]', error.message);
  });

  await new Promise((resolve, reject) => {
    client.once('ready', async () => {
      console.log(`[READY] Logged in as: ${client.user.tag}`);
      resolve();
    });

    client.login(token).catch(reject);
    setTimeout(() => reject(new Error('Login timeout')), 30000);
  });

  setupResetListener(client);

  return client;
}

(async () => {
  try {
    process.on('unhandledRejection', (error) => {
      console.error('[UNHANDLED REJECTION]', error.message);
    });

    while (true) {
      activeClients = [];

      try {
        const burstCount = config.burstCount || 1;
        const tokensToUse = await getTokensToUse(burstCount);
        
        console.log(`[INIT] Fetching ${burstCount} least recently used token(s) from SQLite...`);
        
        for (const token of tokensToUse) {
           const client = await createAndLoginClient(token);
           activeClients.push(client);
        }

        console.log('[READY] Waiting 5 seconds for full initialization of all clients...');
        await new Promise(r => setTimeout(r, 5000));
        console.log(`[READY] ${activeClients.length} client(s) ready`);

        const result = await performLikeCycle(activeClients);

        await updateTokenUsage(tokensToUse);

        if (result && result.status === 'success') {
          console.log('[CYCLE] Like cycle completed successfully');
          console.log('[CYCLE] Disconnecting current clients and switching tokens...');
        } else if (result && result.status === 'wait') {
          const waitTime = result.waitTime;
          console.log(`[CYCLE] Need to wait for ${Math.floor(waitTime / 1000)} seconds before next cycle`);

          for (const c of activeClients) {
            try { await c.destroy(); } catch (e) {}
          }
          activeClients = [];
          console.log('[CLEANUP] Clients disconnected for waiting period');

          const sleepTime = waitTime - 20000;
          if (sleepTime > 0) {
            console.log(`[SLEEP] Sleeping for ${Math.floor(sleepTime / 1000)} seconds...`);
            await new Promise(resolve => setTimeout(resolve, sleepTime));
          } else {
            console.log('[SLEEP] Sleep time is too short, proceeding immediately to recreate clients');
          }
        }

      } catch (error) {
        console.error('[CYCLE ERROR]', error.message);
        console.log('[RETRY] Retrying in 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } finally {
        for (const c of activeClients) {
          try { await c.destroy(); } catch (e) {}
        }
        activeClients = [];
        console.log('[CLEANUP] All clients disconnected');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

  } catch (error) {
    console.error('[FATAL ERROR]', error.message);
    process.exit(1);
  }
})();
