(function () {
    'use strict';

    const PASSWORD_HASH = '7c7b3a64a1b9ddcec9c0dc3b790922aa1c6783c28c1346c7a5422f90cffaf646';
    const SESSION_KEY = 'ballistica.auth.ok';
    const FORCE_AUTH = new URLSearchParams(window.location.search).get('auth') === '1';
    const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
    const isLocal = window.location.protocol === 'file:' || LOCAL_HOSTS.has(window.location.hostname);

    if (isLocal && !FORCE_AUTH) {
        return;
    }

    function readSession() {
        try {
            return window.sessionStorage.getItem(SESSION_KEY);
        } catch (error) {
            return null;
        }
    }

    function writeSession() {
        try {
            window.sessionStorage.setItem(SESSION_KEY, PASSWORD_HASH);
        } catch (error) {
            // Storage may be blocked; the current page can still be unlocked.
        }
    }

    if (readSession() === PASSWORD_HASH) {
        return;
    }

    const gateStyle = document.createElement('style');
    gateStyle.id = 'ballisticaAuthStyle';
    gateStyle.textContent = `
        body > :not(#ballisticaAuthGate) {
            visibility: hidden !important;
        }

        #ballisticaAuthGate {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: grid;
            place-items: center;
            background: #0b0e10;
            color: #c8cdd0;
            font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            visibility: visible !important;
        }

        #ballisticaAuthGate form {
            width: min(320px, calc(100vw - 32px));
            display: grid;
            gap: 10px;
            padding: 18px;
            background: #11161b;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 8px;
            box-shadow: 0 24px 80px rgba(0,0,0,0.45);
        }

        #ballisticaAuthGate h1 {
            margin: 0 0 2px;
            color: #f0b24f;
            font-size: 18px;
            line-height: 1.2;
        }

        #ballisticaAuthGate label {
            display: grid;
            gap: 5px;
            color: #96a8b6;
            font-size: 12px;
        }

        #ballisticaAuthGate input {
            width: 100%;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 5px;
            background: rgba(255,255,255,0.06);
            color: #eef2f4;
            font: inherit;
        }

        #ballisticaAuthGate button {
            padding: 8px 12px;
            border: 1px solid rgba(240,178,79,0.48);
            border-radius: 5px;
            background: rgba(240,178,79,0.14);
            color: #f0b24f;
            cursor: pointer;
            font: 600 13px/1.2 inherit;
        }

        #ballisticaAuthGate .auth-error {
            min-height: 18px;
            color: #f25f5c;
            font-size: 12px;
        }
    `;
    (document.head || document.documentElement).appendChild(gateStyle);

    function toHex(buffer) {
        return Array.from(new Uint8Array(buffer), function (byte) {
            return byte.toString(16).padStart(2, '0');
        }).join('');
    }

    async function sha256(value) {
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error('WebCrypto is unavailable. Serve the page over HTTPS.');
        }

        const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return toHex(buffer);
    }

    function unlock(gate) {
        writeSession();
        gate.remove();
        gateStyle.remove();
    }

    function mountGate() {
        const gate = document.createElement('div');
        gate.id = 'ballisticaAuthGate';
        gate.innerHTML = `
            <form autocomplete="off">
                <h1>Ballistica</h1>
                <label>
                    Production password
                    <input name="password" type="password" autofocus>
                </label>
                <button type="submit">Unlock</button>
                <div class="auth-error" role="alert"></div>
            </form>
        `;

        const form = gate.querySelector('form');
        const input = gate.querySelector('input');
        const error = gate.querySelector('.auth-error');

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            error.textContent = '';
            try {
                const hash = await sha256(input.value);
                if (hash === PASSWORD_HASH) {
                    unlock(gate);
                    return;
                }

                error.textContent = 'Wrong password';
            } catch (authError) {
                error.textContent = authError.message;
            } finally {
                input.value = '';
                input.focus();
            }
        });

        document.body.appendChild(gate);
        input.focus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountGate, { once: true });
    } else {
        mountGate();
    }
}());
