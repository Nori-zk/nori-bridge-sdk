import path from 'path';
import { fileURLToPath } from 'url';

// Root dir

const __filename = fileURLToPath(import.meta.url);
export const rootDir = path.dirname(__filename);