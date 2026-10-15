/// <reference types="vite/client" />
declare module 'virtual:dataset' {
  import type { Dataset } from './model/dataset'
  const dataset: Dataset
  export default dataset
}
