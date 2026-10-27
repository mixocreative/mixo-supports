import { setDentalEngine } from '../../src/core/analysis/dentalEngine';
import { setTransformEngine } from '../../src/state/transformEngine';
import { setSupportEngine } from '../../src/supports/supportEngine';
import { nodeEngine } from './rustImport';

/* Tests and Node scripts run the production Rust matrix calls on the pkg-node build. */
setTransformEngine(nodeEngine);
setSupportEngine(nodeEngine);
setDentalEngine(nodeEngine as unknown as Parameters<typeof setDentalEngine>[0]);
