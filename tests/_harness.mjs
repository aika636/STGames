// Минимальный раннер для node-тестов ядра. Никаких зависимостей: расширение должно
// оставаться без сборки и без npm-пакетов, тесты — тоже.

let passed = 0;
const failures = [];

// Синхронный тест выполняется сразу; асинхронный возвращает промис, и вызывающий файл
// обязан его дождаться (`await test(...)`) — иначе тесты пойдут внахлёст и будут мешать
// друг другу общим состоянием.
export function test(name, fn) {
    const ok = () => {
        passed++;
        console.log(`  ✓ ${name}`);
    };
    const fail = (err) => {
        failures.push({ name, err });
        console.log(`  ✗ ${name}`);
        console.log(`      ${err.message.split('\n').join('\n      ')}`);
    };

    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(ok, fail);
        }
        ok();
    } catch (err) {
        fail(err);
    }
    return undefined;
}

export function report(suite) {
    const total = passed + failures.length;
    console.log(`\n${suite}: ${passed}/${total} прошло`);
    if (failures.length) {
        process.exitCode = 1;
    }
}

export function assert(condition, message) {
    if (!condition) throw new Error(message || 'ожидалось истинное значение');
}

export function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'значения не совпали'}: получено ${actual}, ожидалось ${expected}`);
    }
}
