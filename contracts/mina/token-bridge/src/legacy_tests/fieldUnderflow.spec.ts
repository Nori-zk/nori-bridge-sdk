import { Logger, LogPrinter } from 'esm-iso-logger';
import { Field } from 'o1js';

new LogPrinter('TestTokenBridge');
const logger = new Logger('FieldUnderflowSpec');

it('detect_underflow', () => {
    const a = new Field(1);
    const b = new Field(2);
    const c = a.sub(b);
    logger.log(c.toBigInt()); // this underflows
    a.assertGreaterThanOrEqual(b, 'Underflow detected');
});
