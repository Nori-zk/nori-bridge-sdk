import { Field } from 'o1js';

it('detect_underflow', () => {
    const a = new Field(1);
    const b = new Field(2);
    const c = a.sub(b);
    console.log(c.toBigInt()); // this underflows
    a.assertGreaterThanOrEqual(b, 'Underflow detected');
});
