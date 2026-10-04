// 页面上下文中的只读诊断桥接，方便用户在开发者控制台直接调用。
(function installBilibiliAmbientlightDiagnosticsBridge() {
  const key = '__bilibiliAmbientlightDiagnostics';
  const state = {
    payload: null,
    updatedAt: null,
    requestId: 0,
    pending: new Map(),
  };

  const requestDiagnostics = (timeout = 1500) => {
    const requestId = `${Date.now()}-${++state.requestId}`;
    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error('等待扩展诊断响应超时。'));
      }, timeout);

      state.pending.set(requestId, {
        resolve: (payload) => {
          clearTimeout(timeoutId);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
    });

    window.postMessage(
      {
        source: 'bilibili-ambientlight-diagnostics-request',
        requestId,
      },
      '*'
    );
    return promise;
  };

  globalThis[key] = {
    dump() {
      return (
        state.payload || {
          error: '尚未收到诊断数据，请刷新视频页并等待扩展初始化。',
        }
      );
    },
    copy() {
      const text = JSON.stringify(this.dump(), null, 2);
      return navigator.clipboard.writeText(text).then(
        () => text,
        () => {
          console.info(text);
          return text;
        }
      );
    },
    async refresh() {
      state.payload = await requestDiagnostics();
      state.updatedAt = new Date().toISOString();
      return state.payload;
    },
    get updatedAt() {
      return state.updatedAt;
    },
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source === 'bilibili-ambientlight-diagnostics') {
      state.payload = event.data.payload;
      state.updatedAt = new Date().toISOString();
      return;
    }
    if (event.data?.source !== 'bilibili-ambientlight-diagnostics-response') {
      return;
    }

    const pending = state.pending.get(event.data.requestId);
    if (!pending) return;
    state.pending.delete(event.data.requestId);
    pending.resolve(event.data.payload);
  });

  requestDiagnostics().catch(() => {});
})();
