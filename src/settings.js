const KEY = '__TICKTICK_SECRET_KEY__';
const $ = (selector) => document.querySelector(selector);
const statusDot = $('#dot');
const statusText = $('#statusText');
const accountsBox = $('#accounts');
const messageBox = $('#message');
const connectButton = $('#connect');

function setMessage(text, tone = '') {
  messageBox.textContent = text;
  messageBox.className = `message${tone ? ` ${tone}` : ''}`;
}

function setBusy(busy) {
  connectButton.disabled = busy;
  for (const button of accountsBox.querySelectorAll('button')) button.disabled = busy;
}

function errorText(code, detail) {
  const messages = {
    NO_CLIENT_CONFIG: 'This plugin is missing its TickTick OAuth client. Reinstall the plugin.',
    ACCOUNT_LIMIT: 'This plugin already has the maximum number of TickTick accounts connected.',
    LISTEN_FAILED: 'The local OAuth callback port is busy. Another program may be using it; close it and try again.',
    TIMEOUT: 'The browser sign-in timed out. Click Connect and try again.',
    CANCELLED: 'Sign-in was cancelled.',
    CALLBACK_INVALID: 'TickTick returned an invalid OAuth callback. Try connecting again.',
    EXCHANGE_FAILED: 'TickTick rejected the authorization code. Try connecting again.',
    NETWORK: 'Cindy could not reach TickTick. Check your network and try again.',
    SERVICE_UNAVAILABLE: 'TickTick’s authorization service is unavailable. Try again shortly.',
  };
  return `${messages[code] || code || 'Connection failed'}${detail ? `\n${detail}` : ''}`;
}

function accountName(account) {
  return account.label || account.id || 'TickTick account';
}

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

function renderAccounts(accounts) {
  accountsBox.replaceChildren();
  if (!accounts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No TickTick account connected yet.';
    accountsBox.append(empty);
    return;
  }

  for (const account of accounts) {
    const row = document.createElement('div');
    row.className = 'account';

    const main = document.createElement('div');
    main.className = 'account-main';
    const name = document.createElement('div');
    name.className = 'account-name';
    name.textContent = accountName(account);
    if (account.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Default';
      name.append(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'account-meta';
    meta.textContent =
      account.status === 'expired'
        ? 'Authorization expired — reconnect this account.'
        : account.status === 'connected'
          ? 'Connected'
          : account.status || 'Unknown status';
    main.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'account-actions';

    if (!account.isDefault) {
      actions.append(
        makeButton('Use as default', '', async () => {
          setBusy(true);
          try {
            const response = await fetch(`/oauth/${KEY}/default`, {
              method: 'POST',
              body: JSON.stringify({ accountId: account.id }),
            });
            if (response.status !== 204) throw new Error(`HTTP ${response.status}`);
            setMessage('Default account updated.', 'ok');
            await refresh();
          } catch (error) {
            setMessage(`Could not change the default account: ${error.message}`, 'error');
          } finally {
            setBusy(false);
          }
        }),
      );
    }

    actions.append(
      makeButton('Reconnect', '', () => connect()),
      makeButton(
        'Disconnect',
        'danger',
        async () => {
          if (!window.confirm(`Disconnect ${accountName(account)} from this plugin?`)) return;
          setBusy(true);
          try {
            const response = await fetch(`/oauth/${KEY}/accounts/${encodeURIComponent(account.id)}`, {
              method: 'DELETE',
            });
            if (response.status !== 204) throw new Error(`HTTP ${response.status}`);
            setMessage('Account disconnected.', 'ok');
            await refresh();
          } catch (error) {
            setMessage(`Could not disconnect: ${error.message}`, 'error');
          } finally {
            setBusy(false);
          }
        },
      ),
    );

    row.append(main, actions);
    accountsBox.append(row);
  }
}

async function refresh() {
  try {
    const response = await fetch('/oauth');
    if (!response.ok) throw new Error(`Could not read account status (HTTP ${response.status}).`);
    const items = await response.json();
    const item = Array.isArray(items) ? items.find((entry) => entry.key === KEY) : null;
    const accounts = item?.accounts || [];
    const connected = accounts.some((account) => account.status === 'connected');
    statusDot.className = `dot ${connected ? 'ok' : 'bad'}`;
    statusText.textContent = connected
      ? `${accounts.filter((account) => account.status === 'connected').length} connected`
      : 'Not connected';
    if (item && !item.clientConfigured) {
      setMessage('The built-in TickTick OAuth client is missing. Reinstall the plugin.', 'error');
    }
    renderAccounts(accounts);
  } catch (error) {
    statusDot.className = 'dot bad';
    statusText.textContent = 'Unavailable';
    setMessage(error.message || String(error), 'error');
  }
}

async function connect() {
  setBusy(true);
  setMessage('Complete the TickTick sign-in in your browser…');
  try {
    const response = await fetch(`/oauth/${KEY}/connect`, { method: 'POST' });
    if (!response.ok) {
      setMessage(`Could not start the connection (HTTP ${response.status}).`, 'error');
      return;
    }
    const result = await response.json();
    if (!result.ok) {
      setMessage(errorText(result.error, result.detail), 'error');
      return;
    }
    setMessage('TickTick connected.', 'ok');
    await refresh();
  } catch (error) {
    setMessage(`Could not start the connection: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

connectButton.addEventListener('click', connect);
refresh();
