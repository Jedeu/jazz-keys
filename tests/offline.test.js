import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
function worker(scope) {
  const handlers = new Map();
  const stores = new Map();
  const deleted = [];
  let networkRequests = 0;
  let claimed = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) {
          for (const request of requests) store.set(request.url, { cached: request.url });
        },
        async match(request, options = {}) {
          const url = new URL(typeof request === "string" ? request : request.url);
          if (options.ignoreSearch) url.search = "";
          return store.get(url.href);
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deleted.push(name); return stores.delete(name); },
  };
  vm.runInNewContext(source, {
    URL, Request, caches,
    fetch() { networkRequests++; throw new Error("Offline"); },
    self: {
      registration: { scope },
      location: new URL("sw.js", scope),
      clients: { async claim() { claimed = true; } },
      addEventListener(name, handler) { handlers.set(name, handler); },
    },
  });
  return {
    stores, deleted,
    get networkRequests() { return networkRequests; },
    get claimed() { return claimed; },
    lifecycle(name) {
      let work;
      handlers.get(name)({ waitUntil(promise) { work = promise; } });
      return work;
    },
    fetch(path, mode = "cors", method = "GET") {
      let work;
      handlers.get("fetch")({
        request: { url: new URL(path, scope).href, mode, method },
        respondWith(promise) { work = promise; },
      });
      return work;
    },
  };
}

for (const path of ["/", "/personal/jazz-keys/"]) {
  test(`offline shell works at ${path}, including a query-string launch`, async () => {
    const scope = `https://example.test${path}`;
    const sw = worker(scope);
    await sw.lifecycle("install");
    const assets = [...sw.stores.values()][0];
    for (const url of assets.keys()) {
      assert.ok(url.startsWith(scope));
      const relative = url.slice(scope.length);
      assert.ok((await readFile(new URL(`../${relative}`, import.meta.url))).length > 0, `${relative} must ship`);
    }
    assert.equal((await sw.fetch("./?source=home", "navigate")).cached, `${scope}index.html`);
    assert.equal((await sw.fetch("./src/app.js")).cached, `${scope}src/app.js`);
    assert.equal((await sw.fetch("./icons/apple-touch-icon.png")).cached, `${scope}icons/apple-touch-icon.png`);
    assert.equal(sw.networkRequests, 0);
  });
}
test("activation removes only this app's old cache", async () => {
  const scope = "https://example.test/jazz/";
  const sw = worker(scope);
  sw.stores.set(`jazz-keys:${scope}:v0`, new Map());
  sw.stores.set("some-other-app:v1", new Map());
  sw.stores.set("jazz-keys:https://example.test/other/:v0", new Map());
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  assert.deepEqual(sw.deleted, [`jazz-keys:${scope}:v0`]);
  assert.equal(sw.claimed, true);
});
test("does not intercept third-party requests or writes", () => {
  const sw = worker("https://example.test/jazz/");
  assert.equal(sw.fetch("https://elsewhere.test/anything"), undefined);
  assert.equal(sw.fetch("./", "cors", "POST"), undefined);
});
