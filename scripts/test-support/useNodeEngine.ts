import { setTransformEngine } from '../../src/state/transformEngine';
import { nodeEngine } from './rustImport';

/* Tests and Node scripts run the production Rust matrix calls on the pkg-node build. */
setTransformEngine(nodeEngine);
