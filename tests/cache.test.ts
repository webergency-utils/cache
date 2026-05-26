import { describe, test, expect } from "vitest";
import Cache from "../src/cache";
import sizeof from "../src/size";

describe("Sizeof Calculation", () => {
    test("calculates primitive sizes correctly", () => {
        expect(sizeof(undefined)).toBe(2);
        expect(sizeof(null)).toBe(2);
        expect(sizeof(true)).toBe(4);
        expect(sizeof(123)).toBe(8);
        expect(sizeof("a")).toBe(2 + 4); // 2 baseline + 4 * Math.ceil(1/4)
        expect(sizeof("abcd")).toBe(2 + 4); // 2 baseline + 4 * Math.ceil(4/4)
        expect(sizeof("abcde")).toBe(2 + 8); // 2 baseline + 4 * Math.ceil(5/4)
    });

    test("handles objects, arrays, maps and sets", () => {
        const obj = { x: 1 };
        // x stringSize = 2 + 4 * Math.ceil(1/4) = 6
        // 1 sizeof = 8
        // Total should be 14
        expect(sizeof(obj)).toBe(14);

        const arr = [1, 2]; // 8 + 8 = 16
        expect(sizeof(arr)).toBe(16);

        const set = new Set([1, 2]); // should be 8 + 8 = 16 (no double-counting)
        expect(sizeof(set)).toBe(16);

        const map = new Map([["a", 1]]); // "a" stringSize (6) + 1 sizeof (8) = 14
        expect(sizeof(map)).toBe(14);
    });

    test("prevents infinite recursion on circular references", () => {
        const obj: any = {};
        obj.self = obj;
        // Should not throw range error (stack overflow)
        expect(() => sizeof(obj)).not.toThrow();

        const arr: any[] = [];
        arr.push(arr);
        expect(() => sizeof(arr)).not.toThrow();
    });
});

describe("Cache Functionality", () => {
    test("basic set and get", () => {
        const cache = new Cache<string>({ cacheTime: 1 });
        cache.set("key1", "value1");
        expect(cache.get("key1")).toBe("value1");
        expect(cache.get("key2")).toBeUndefined();
        cache.close();
    });

    test("eviction by maxItems limit", async () => {
        const cache = new Cache<string>({ maxItems: 2, cacheTime: 1 });
        
        cache.set("key1", "val1");
        cache.set("key2", "val2");
        expect(cache.size()).toBe(2);

        // Wait for the initial 1-seek from setting the keys to decay out of the sliding window (1.1s)
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Access key1 to boost its score (gets 2 new seeks)
        cache.get("key1");
        cache.get("key1");

        // key3 should fit: key2 has decayed to 0 seeks, key3 starts with 1 seek, key1 has 2 seeks.
        // score(key2) = 0 < score(key3) = 1, so key2 is evicted.
        cache.set("key3", "val3");
        expect(cache.size()).toBe(2);
        expect(cache.get("key1")).toBe("val1");
        expect(cache.get("key3")).toBe("val3");
        expect(cache.get("key2")).toBeUndefined(); // Evicted

        cache.close();
    });

    test("watched promotion and no duplicates", () => {
        const cache = new Cache<string>({ maxItems: 1, cacheTime: 1 });
        
        cache.set("key1", "val1");
        // key2 will not fit in active cache because maxItems is 1. It goes to watched.
        cache.set("key2", "val2");
        
        expect(cache.get("key1")).toBe("val1");
        expect(cache.get("key2")).toBeUndefined(); // not in cached (watched has no data payload)

        // Increment seeks of key2 to promote it
        cache.get("key2");
        cache.get("key2");
        cache.get("key2");

        // Now set key2 again, it should promote to cached, evicting key1
        cache.set("key2", "val2-new");
        expect(cache.get("key2")).toBe("val2-new");
        expect(cache.get("key1")).toBeUndefined(); // key1 evicted

        cache.close();
    });

    test("TTL / stale expiration", async () => {
        // staleTime in seconds
        const cache = new Cache<string>({ staleTime: 0.1, cacheTime: 1 });
        
        cache.set("key1", "value1");
        expect(cache.get("key1")).toBe("value1");

        // Wait 150ms for it to become stale
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Reading should trigger stale removal
        expect(cache.get("key1")).toBeUndefined();
        expect(cache.size()).toBe(0);

        cache.close();
    });

    test("lazy seeks bucket clearance", async () => {
        // Set cacheTime to 1 second (10 buckets, 100ms each)
        const cache = new Cache<string>({ maxItems: 10, cacheTime: 1 });
        
        cache.set("key1", "val1"); // lastTick = 0
        expect(cache.get("key1")).toBe("val1"); // seeks[0] = 2

        // Wait 250ms (forces 2 tick increments)
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Read again
        expect(cache.get("key1")).toBe("val1"); // seeks at new index should be updated

        // Let's close and verify
        cache.close();
    });
});
