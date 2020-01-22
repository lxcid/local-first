require('@babel/register')({ presets: ['@babel/preset-flow'] });
const sa = require('../sorted-array');
const a = {};
sa.push(a, 'a');
console.log(sa.sorted(a), a);
sa.push(a, 'b');
console.log(sa.sorted(a), a);
sa.push(a, 'c');
console.log(sa.sorted(a), a);
sa.unshift(a, 'd');
console.log(sa.sorted(a), a);
sa.insert(a, 'e', 'b', 'c');
console.log(sa.sorted(a), a);
sa.insert(a, 'f', 'e', 'c');
console.log(sa.sorted(a), a);
