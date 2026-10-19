// Storage boundary: the default contract stays sparse JSON until the T05b review.
export {
  parseWorkbook as readModel,
  stringifyWorkbook as writeModel,
} from "../model/workbook.mjs";
