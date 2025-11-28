/**
 * Polyfills para Smart TVs antigas
 * Samsung Tizen 2016-2017: Chromium 47-56
 * LG webOS 3.x: Chromium 38-53
 */

// Object.assign - Chromium 45+
if (typeof Object.assign !== 'function') {
  Object.assign = function (target: object, ...sources: object[]): object {
    if (target == null) {
      throw new TypeError('Cannot convert undefined or null to object');
    }
    const to = Object(target);
    for (const source of sources) {
      if (source != null) {
        for (const key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            (to as Record<string, unknown>)[key] = (source as Record<string, unknown>)[key];
          }
        }
      }
    }
    return to;
  };
}

// Array.prototype.includes - Chromium 47+
if (!Array.prototype.includes) {
  Array.prototype.includes = function <T>(this: T[], searchElement: T, fromIndex?: number): boolean {
    const len = this.length;
    let k = fromIndex || 0;
    if (k < 0) k = Math.max(len + k, 0);
    while (k < len) {
      if (this[k] === searchElement) return true;
      k++;
    }
    return false;
  };
}

// String.prototype.includes - Chromium 41+
if (!String.prototype.includes) {
  String.prototype.includes = function (search: string, start?: number): boolean {
    if (typeof start !== 'number') start = 0;
    if (start + search.length > this.length) return false;
    return this.indexOf(search, start) !== -1;
  };
}

// String.prototype.startsWith - Chromium 41+
if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (search: string, pos?: number): boolean {
    const position = pos || 0;
    return this.substr(position, search.length) === search;
  };
}

// String.prototype.endsWith - Chromium 41+
if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (search: string, length?: number): boolean {
    const len = length === undefined ? this.length : length;
    return this.substring(len - search.length, len) === search;
  };
}

// Array.prototype.find - Chromium 45+
if (!Array.prototype.find) {
  Array.prototype.find = function <T>(
    this: T[],
    predicate: (value: T, index: number, obj: T[]) => boolean
  ): T | undefined {
    for (let i = 0; i < this.length; i++) {
      if (predicate(this[i], i, this)) return this[i];
    }
    return undefined;
  };
}

// Array.prototype.findIndex - Chromium 45+
if (!Array.prototype.findIndex) {
  Array.prototype.findIndex = function <T>(
    this: T[],
    predicate: (value: T, index: number, obj: T[]) => boolean
  ): number {
    for (let i = 0; i < this.length; i++) {
      if (predicate(this[i], i, this)) return i;
    }
    return -1;
  };
}

// Promise.prototype.finally - Chromium 63+ (mais novo, precisa de polyfill)
if (!Promise.prototype.finally) {
  Promise.prototype.finally = function <T>(this: Promise<T>, onFinally?: (() => void) | null): Promise<T> {
    return this.then(
      (value) => Promise.resolve(onFinally?.()).then(() => value),
      (reason) => Promise.resolve(onFinally?.()).then(() => { throw reason; })
    );
  };
}

// Object.entries - Chromium 54+
if (!Object.entries) {
  Object.entries = function <T>(obj: { [s: string]: T }): [string, T][] {
    return Object.keys(obj).map((key) => [key, obj[key]]);
  };
}

// Object.values - Chromium 54+
if (!Object.values) {
  Object.values = function <T>(obj: { [s: string]: T }): T[] {
    return Object.keys(obj).map((key) => obj[key]);
  };
}

// Array.from - Chromium 45+
if (!Array.from) {
  Array.from = function <T, U>(
    arrayLike: ArrayLike<T>,
    mapFn?: (v: T, k: number) => U
  ): U[] {
    const arr: U[] = [];
    for (let i = 0; i < arrayLike.length; i++) {
      arr.push(mapFn ? mapFn(arrayLike[i], i) : arrayLike[i] as unknown as U);
    }
    return arr;
  };
}

// Number.isNaN - Chromium 25+
if (!Number.isNaN) {
  Number.isNaN = function (value: unknown): value is number {
    return typeof value === 'number' && isNaN(value);
  };
}

// Number.isFinite - Chromium 19+
if (!Number.isFinite) {
  Number.isFinite = function (value: unknown): value is number {
    return typeof value === 'number' && isFinite(value);
  };
}

// CustomEvent polyfill para IE11 e TVs antigas
if (typeof window !== 'undefined' && typeof window.CustomEvent !== 'function') {
  function CustomEvent<T>(
    event: string,
    params?: CustomEventInit<T>
  ): CustomEvent<T> {
    params = params || { bubbles: false, cancelable: false, detail: undefined };
    const evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles!, params.cancelable!, params.detail);
    return evt as CustomEvent<T>;
  }
  CustomEvent.prototype = window.Event.prototype;
  (window as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent = CustomEvent;
}

// requestAnimationFrame polyfill
if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  let lastTime = 0;
  window.requestAnimationFrame = function (callback: FrameRequestCallback): number {
    const currTime = Date.now();
    const timeToCall = Math.max(0, 16 - (currTime - lastTime));
    const id = window.setTimeout(() => callback(currTime + timeToCall), timeToCall);
    lastTime = currTime + timeToCall;
    return id;
  };
  window.cancelAnimationFrame = function (id: number): void {
    clearTimeout(id);
  };
}

export {};
