import {createHash} from 'node:crypto';
import {ECHARTS_VERSION,ECHARTS_INTEGRITY} from '../src/echarts.js';

export function verifyECharts(bytes,version) {
  if (version!==ECHARTS_VERSION) throw new Error(`ECharts : version ${version} unexpected; ${ECHARTS_VERSION} required`);
  const digest='sha384-'+createHash('sha384').update(bytes).digest('base64');
  if (digest!==ECHARTS_INTEGRITY) throw new Error('ECharts: integrity differs from the approved digest; verify the dependency before changing the SRI hash');
}
