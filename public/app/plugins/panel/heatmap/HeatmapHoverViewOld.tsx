import React, { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';

import {
  DataFrameType,
  Field,
  FieldType,
  formattedValueToString,
  getFieldDisplayName,
  LinkModel,
  TimeRange,
  InterpolateFunction,
} from '@grafana/data';
import { HeatmapCellLayout } from '@grafana/schema';
import { LinkButton, VerticalGroup } from '@grafana/ui';
import { getDashboardSrv } from 'app/features/dashboard/services/DashboardSrv';
import { isHeatmapCellsDense, readHeatmapRowsCustomMeta } from 'app/features/transformers/calculateHeatmap/heatmap';
import { DataHoverView } from 'app/features/visualization/data-hover/DataHoverView';

import { getDataLinks } from '../status-history/utils';

import { HeatmapData } from './fields';
import { renderHistogram } from './renderHistogram';
import { HeatmapHoverEvent } from './utils';

type Props = {
  data: HeatmapData;
  hover: HeatmapHoverEvent;
  showHistogram?: boolean;
  timeRange: TimeRange;
  replaceVars: InterpolateFunction;
};

export const HeatmapHoverView = (props: Props) => {
  if (props.hover.seriesIdx === 2) {
    return <DataHoverView data={props.data.exemplars} rowIndex={props.hover.dataIdx} header={'Exemplar'} />;
  }
  return <HeatmapHoverCell {...props} />;
};

const HeatmapHoverCell = ({ data, hover, showHistogram = false }: Props) => {
  const index = hover.dataIdx;

  const [isSparse] = useState(
    () => data.heatmap?.meta?.type === DataFrameType.HeatmapCells && !isHeatmapCellsDense(data.heatmap)
  );

  const xField = data.heatmap?.fields[0];
  const yField = data.heatmap?.fields[1];
  const countField = data.heatmap?.fields[2];

  const xDisp = (v: number) => {
    if (xField?.display) {
      return formattedValueToString(xField.display(v));
    }
    if (xField?.type === FieldType.time) {
      const tooltipTimeFormat = 'YYYY-MM-DD HH:mm:ss';
      const dashboard = getDashboardSrv().getCurrent();
      return dashboard?.formatDate(v, tooltipTimeFormat);
    }
    return `${v}`;
  };

  const xVals = xField?.values;
  const yVals = yField?.values;
  const countVals = countField?.values;

  // labeled buckets
  const meta = readHeatmapRowsCustomMeta(data.heatmap);
  const yDisp = yField?.display ? (v: string) => formattedValueToString(yField.display!(v)) : (v: string) => `${v}`;

  const yValueIdx = index % (data.yBucketCount ?? 1);
  const xValueIdx = Math.floor(index / (data.yBucketCount ?? 1));

  let yBucketMin: string;
  let yBucketMax: string;

  let nonNumericOrdinalDisplay: string | undefined = undefined;

  if (meta.yOrdinalDisplay) {
    const yMinIdx = data.yLayout === HeatmapCellLayout.le ? yValueIdx - 1 : yValueIdx;
    const yMaxIdx = data.yLayout === HeatmapCellLayout.le ? yValueIdx : yValueIdx + 1;
    yBucketMin = yMinIdx < 0 ? meta.yMinDisplay! : `${meta.yOrdinalDisplay[yMinIdx]}`;
    yBucketMax = `${meta.yOrdinalDisplay[yMaxIdx]}`;

    // e.g. "pod-xyz123"
    if (!meta.yOrdinalLabel || Number.isNaN(+meta.yOrdinalLabel[0])) {
      nonNumericOrdinalDisplay = data.yLayout === HeatmapCellLayout.le ? yBucketMax : yBucketMin;
    }
  } else {
    const value = yVals?.[yValueIdx];

    if (data.yLayout === HeatmapCellLayout.le) {
      yBucketMax = `${value}`;

      if (data.yLog) {
        let logFn = data.yLog === 2 ? Math.log2 : Math.log10;
        let exp = logFn(value) - 1 / data.yLogSplit!;
        yBucketMin = `${data.yLog ** exp}`;
      } else {
        yBucketMin = `${value - data.yBucketSize!}`;
      }
    } else {
      yBucketMin = `${value}`;

      if (data.yLog) {
        let logFn = data.yLog === 2 ? Math.log2 : Math.log10;
        let exp = logFn(value) + 1 / data.yLogSplit!;
        yBucketMax = `${data.yLog ** exp}`;
      } else {
        yBucketMax = `${value + data.yBucketSize!}`;
      }
    }
  }

  let xBucketMin: number;
  let xBucketMax: number;

  if (data.xLayout === HeatmapCellLayout.le) {
    xBucketMax = xVals?.[index];
    xBucketMin = xBucketMax - data.xBucketSize!;
  } else {
    xBucketMin = xVals?.[index];
    xBucketMax = xBucketMin + data.xBucketSize!;
  }

  const count = countVals?.[index];

  let links: Array<LinkModel<Field>> = [];

  const linksField = data.series?.fields[yValueIdx + 1];

  if (linksField != null) {
    const visible = !Boolean(linksField.config.custom?.hideFrom?.tooltip);
    const hasLinks = (linksField.config.links?.length ?? 0) > 0;

    if (visible && hasLinks) {
      links = getDataLinks(linksField, xValueIdx);
    }
  }

  let can = useRef<HTMLCanvasElement>(null);

  let histCssWidth = 264;
  let histCssHeight = 64;
  let histCanWidth = Math.round(histCssWidth * uPlot.pxRatio);
  let histCanHeight = Math.round(histCssHeight * uPlot.pxRatio);

  useEffect(
    () => {
      if (showHistogram && xVals != null && countVals != null) {
        renderHistogram(can, histCanWidth, histCanHeight, xVals, countVals, index, data.yBucketCount!);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index]
  );

  if (isSparse) {
    return (
      <div>
        <DataHoverView data={data.heatmap} rowIndex={index} />
      </div>
    );
  }

  const renderYBucket = () => {
    if (nonNumericOrdinalDisplay) {
      return <div>Name: {nonNumericOrdinalDisplay}</div>;
    }

    switch (data.yLayout) {
      case HeatmapCellLayout.unknown:
        return <div>{yDisp(yBucketMin)}</div>;
    }
    return (
      <div>
        Bucket: {yDisp(yBucketMin)} - {yDisp(yBucketMax)}
      </div>
    );
  };

  return (
    <>
      <div>
        <div>{xDisp(xBucketMin)}</div>
        {data.xLayout !== HeatmapCellLayout.unknown && <div>{xDisp(xBucketMax)}</div>}
      </div>
      {showHistogram && (
        <canvas
          width={histCanWidth}
          height={histCanHeight}
          ref={can}
          style={{ width: histCssWidth + 'px', height: histCssHeight + 'px' }}
        />
      )}
      <div>
        {renderYBucket()}
        <div>
          {getFieldDisplayName(countField!, data.heatmap)}: {data.display!(count)}
        </div>
      </div>
      {links.length > 0 && (
        <VerticalGroup>
          {links.map((link, i) => (
            <LinkButton
              key={i}
              icon={'external-link-alt'}
              target={link.target}
              href={link.href}
              onClick={link.onClick}
              fill="text"
              style={{ width: '100%' }}
            >
              {link.title}
            </LinkButton>
          ))}
        </VerticalGroup>
      )}
    </>
  );
};
