import fs from 'fs/promises';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { KeyTransitionStageMessageTypes } from '@nori-zk/pts-types';
KeyTransitionStageMessageTypes
const WIDTH = 1200;
const HEIGHT = 700;
const BACKGROUND = 'white';

const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    backgroundColour: BACKGROUND,
});

function computeMeanStd(arr: number[]): { mean: number; std: number } {
    const n = arr.length;
    if (n === 0) return { mean: 0, std: 0 };
    const mean = arr.reduce((s, v) => s + v, 0) / n;
    let variance = 0;
    if (n > 1) {
        variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    }
    return { mean, std: Math.sqrt(variance) };
}

function computeXAxisRange(values: number[], mean: number, std: number) {
    if (!values.length) return { min: 0, max: 1 };

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    // Compute distances from mean
    const leftDist = Math.max(mean - minVal, std);
    const rightDist = Math.max(maxVal - mean, std);

    const halfWidth = Math.max(leftDist, rightDist);

    const axisMin = mean - halfWidth;
    const axisMax = mean + halfWidth;

    return { min: axisMin, max: axisMax };
}

function binData(values: number[], binSize: number) {
    if (!values.length) return null;

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    const binsCount = Math.max(1, Math.ceil((maxVal - minVal) / binSize));
    const binCounts = new Array<number>(binsCount).fill(0);
    const binCenters: number[] = [];

    for (let i = 0; i < binsCount; i++) {
        binCenters.push(minVal + (i + 0.5) * binSize);
    }

    for (const v of values) {
        let idx = Math.floor((v - minVal) / binSize);
        if (idx < 0) idx = 0;
        if (idx >= binsCount) idx = binsCount - 1;
        binCounts[idx]++;
    }

    return { binCounts, binCenters };
}

function verticalLinePlugin(line: {
    x: number;
    label: string;
    color?: string;
    dash?: number[];
    lineWidth?: number;
    fontSize?: number;
}) {
    return {
        id: `verticalLine-${line.x}`, // unique id per line
        afterDraw: (chart: any) => {
            const { ctx, chartArea: area, scales } = chart;
            if (!scales || !scales.x) return;
            ctx.save();

            const xPixel = scales.x.getPixelForValue(line.x);

            ctx.beginPath();
            ctx.setLineDash(line.dash ?? []);
            ctx.strokeStyle = line.color ?? 'black';
            ctx.lineWidth = line.lineWidth ?? 2;
            ctx.moveTo(xPixel, area.top);
            ctx.lineTo(xPixel, area.bottom);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = line.color ?? 'black';
            ctx.font = `${line.fontSize ?? 14}px sans-serif`;
            ctx.fillText(
                line.label,
                xPixel + 4,
                area.top + (line.fontSize ?? 14)
            );

            ctx.restore();
        },
    };
}

function computePrecision(values: number[]): number {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(Math.abs(max - min), Math.abs(min), Math.abs(max));

    if (range === 0) return 2; // default to 2 decimal places for constant data
    const digits = Math.ceil(-Math.log10(range / 10)); // roughly 10 divisions
    return Math.max(digits, 0);
}

function formatNumber(value: number, precision: number): string {
    return value.toFixed(precision);
}

export async function makeHistogram(opts: {
    title: string;
    xLabel: string;
    yLabel: string;
    values: number[];
    binSize: number;
    outFile: string;
}) {
    const { title, xLabel, yLabel, values, binSize, outFile } = opts;
    if (!values || values.length === 0) return;

    const precision = computePrecision(values);
    const { mean, std } = computeMeanStd(values);
    const bins = binData(values, binSize);
    const { min, max } = computeXAxisRange(values, mean, std);

    if (!bins) return;

    const { binCounts, binCenters } = bins;
    const dataPoints = binCenters.map((c, i) => ({ x: c, y: binCounts[i] }));

    const config: any = {
        type: 'bar',
        data: {
            datasets: [
                {
                    label: `${title} (count)`,
                    data: dataPoints,
                    parsing: false,
                    backgroundColor: 'rgba(40,120,255,0.75)',
                },
            ],
        },
        options: {
            responsive: false,
            plugins: {
                title: {
                    display: true,
                    text: title,
                    font: { size: 18 },
                },
                legend: { display: false },
            },
            scales: {
                x: {
                    type: 'linear',
                    min,
                    max,
                    title: { display: true, text: xLabel },
                    ticks: {
                        stepSize: binSize, // one tick per bin
                        precision, // adjust decimal places
                    },
                },
                y: {
                    title: { display: true, text: yLabel },
                    ticks: { precision: 0 },
                },
            },
        },
        plugins: [
            verticalLinePlugin({
                x: mean,
                label: `mean ${formatNumber(mean, precision)}`,
                color: 'green',
                lineWidth: 3,
                fontSize: 16,
            }),
            verticalLinePlugin({
                x: mean - std,
                label: '-1σ',
                color: 'red',
                dash: [6, 6],
                lineWidth: 3,
            }),
            verticalLinePlugin({
                x: mean + std,
                label: '+1σ',
                color: 'red',
                dash: [6, 6],
                lineWidth: 3,
            }),
        ],
    };

    const buffer = await chartJSNodeCanvas.renderToBuffer(config);
    await fs.writeFile(outFile, buffer);
}

type SimulationResult = {
    startedAt: string;
    endedAt: string;
    runsStarted: number;
    runsCompleted: number;
    errors: unknown[];
    successes: {
        depositBlockNumber: number;
        depositStartTime: number;
        humanReadableDepositStartTime: string;
        overallDepositTimeSec: number;
        timingsMap: {
            WaitingForEthFinality: number;
            WaitingForCurrentJobCompletion: Record<string, number>;
            WaitingForPreviousJobCompletion: Record<string, number>;
            ReadyToMint: Record<string, number>;
        };
    }[];
    bridgeTimingsAggregates: Record<string, number[]>;
};

function autoBinSize(
    values: number[],
    targetBins = 10
): number {
    if (values.length === 0) return 0.01; // fallback for empty
    if (values.length === 1) {
        // single value: pick a small fraction to allow separation
        return Math.max(values[0] / 2, 0.01);
    }

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[n - 1];
    const range = max - min;

    if (range === 0) return Math.max(min / 10, 0.01); // all identical values

    // Freedman-Diaconis “raw” bin width
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    let binWidth = (2 * iqr) / Math.cbrt(n);

    if (binWidth <= 0 || !isFinite(binWidth)) {
        binWidth = range / Math.ceil(Math.log2(n) + 1); // fallback
    }

    // Bias toward target number of bins
    const adjustedBinWidth = range / targetBins;

    return Math.max(binWidth, adjustedBinWidth);
}

function autoBinSizeWithTarget(values: number[], targetBins = 10): number {
    if (values.length === 0) return 0.01; // fallback
    if (values.length === 1) return Math.max(values[0] / 2, 0.01);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    if (range === 0) return Math.max(min / 10, 0.01);

    return range / targetBins;
}

function hsvToRgb(h: number, s: number, v: number): string {
    h = h % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0,
        g = 0,
        b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    return `rgb(${r},${g},${b})`;
}

async function makeFirstStageHistogramFromSimulation(
    simulationResult: SimulationResult,
    outFile: string,
    title: string,
    xLabel: string,
    yLabel: string
) {
    const countsPrev: Record<string, number> = {};
    const countsCurr: Record<string, number> = {};

    for (const success of simulationResult.successes) {
        const prevJobs = success.timingsMap.WaitingForPreviousJobCompletion;
        const currJobs = success.timingsMap.WaitingForCurrentJobCompletion;

        if (prevJobs && Object.keys(prevJobs).length > 0) {
            const firstStage = Object.keys(prevJobs)[0];
            countsPrev[firstStage] = (countsPrev[firstStage] ?? 0) + 1;
        } else if (currJobs && Object.keys(currJobs).length > 0) {
            const firstStage = Object.keys(currJobs)[0];
            countsCurr[firstStage] = (countsCurr[firstStage] ?? 0) + 1;
        }
    }

    // Order stages according to KeyTransitionStageMessageTypes
    const prevStages = KeyTransitionStageMessageTypes.filter((s) =>
        countsPrev[s]
    );
    const currStages = KeyTransitionStageMessageTypes.filter((s) =>
        countsCurr[s]
    );

    // Generate shades: darkest = first stage, lightest = last stage
    const prevColors = prevStages.map(
        (_, i) =>
            hsvToRgb(0, 0.7, 0.3 + (0.7 * i) / Math.max(prevStages.length - 1, 1)) // red hue
    );
    const currColors = currStages.map(
        (_, i) =>
            hsvToRgb(220, 0.7, 0.3 + (0.7 * i) / Math.max(currStages.length - 1, 1)) // blue hue
    );

    const datasets = [
        ...prevStages.map((stage, i) => ({
            label: `Prev: ${stage}`,
            data: [countsPrev[stage]],
            backgroundColor: prevColors[i],
        })),
        ...currStages.map((stage, i) => ({
            label: `Curr: ${stage}`,
            data: [countsCurr[stage]],
            backgroundColor: currColors[i],
        })),
    ];

    const config: any = {
        type: "bar",
        data: { labels: ["First Stage Entered"], datasets },
        options: {
            responsive: false,
            plugins: {
                title: { display: true, text: title, font: { size: 18 } },
                legend: { position: "right" }, // legend on RHS
            },
            scales: {
                x: { title: { display: true, text: xLabel } },
                y: { title: { display: true, text: yLabel }, ticks: { precision: 0 } },
            },
        },
    };

    const buffer = await chartJSNodeCanvas.renderToBuffer(config);
    await fs.writeFile(outFile, buffer);
    console.log(`Created chart: '${outFile}'`);
}

async function plotTotalBridgeHeadWait(simulationResult: SimulationResult, namePrefix: string) {
    // Compute total wait per deposit
    const totalWaits: number[] = simulationResult.successes.map((success) => {
        const currentJobs = success.timingsMap.WaitingForCurrentJobCompletion;
        const previousJobs = success.timingsMap.WaitingForPreviousJobCompletion;

        const sumCurrent = currentJobs ? Object.values(currentJobs).reduce((a, b) => a + b, 0) : 0;
        const sumPrevious = previousJobs ? Object.values(previousJobs).reduce((a, b) => a + b, 0) : 0;

        return sumCurrent + sumPrevious;
    });

    const title = `${namePrefix} Total Bridge Head Wait Time`;
    const outFile = `${title.replaceAll(/ /g, '-').toLowerCase()}.png`;
    const binSize = autoBinSizeWithTarget(totalWaits);

    await makeHistogram({
        values: totalWaits,
        title,
        xLabel: 'Total Bridge Head Wait Time [Seconds]',
        yLabel: 'Count [Deposits]',
        binSize,
        outFile,
    });

    console.log(`Created chart: '${outFile}'`);
}

async function plotTotalBridgeHeadWaitExcludingMina(simulationResult: SimulationResult, namePrefix: string) {
    const totalWaits: number[] = simulationResult.successes.map((success) => {
        const currentJobs = success.timingsMap.WaitingForCurrentJobCompletion;
        const previousJobs = success.timingsMap.WaitingForPreviousJobCompletion;

        const sumCurrent = currentJobs
            ? Object.entries(currentJobs)
                  .filter(([stage]) => stage !== 'EthProcessorTransactionSubmitSucceeded')
                  .reduce((sum, [, v]) => sum + v, 0)
            : 0;

        const sumPrevious = previousJobs
            ? Object.entries(previousJobs)
                  .filter(([stage]) => stage !== 'EthProcessorTransactionSubmitSucceeded')
                  .reduce((sum, [, v]) => sum + v, 0)
            : 0;

        return sumCurrent + sumPrevious;
    });

    const title = `${namePrefix} Total Bridge Head Wait Time (excluding mina finalization)`;
    const outFile = `${title.replaceAll(/ /g, '-').toLowerCase()}.png`;
    const binSize = autoBinSizeWithTarget(totalWaits);

    await makeHistogram({
        values: totalWaits,
        title,
        xLabel: 'Total Bridge Head Wait Time [Seconds]',
        yLabel: 'Count [Deposits]',
        binSize,
        outFile,
    });

    console.log(`Created chart: '${outFile}'`);
}

async function plotEthProcessorProcessingTime(simulationResult: SimulationResult, namePrefix: string) {
    const relevantStages = ['EthProcessorProofRequest', 'EthProcessorTransactionSubmitting'];

    const totalWaits: number[] = simulationResult.successes.map((success) => {
        const currentJobs = success.timingsMap.WaitingForCurrentJobCompletion;
        const previousJobs = success.timingsMap.WaitingForPreviousJobCompletion;

        const sumCurrent = currentJobs
            ? Object.entries(currentJobs)
                  .filter(([stage]) => relevantStages.includes(stage))
                  .reduce((sum, [, v]) => sum + v, 0)
            : 0;

        const sumPrevious = previousJobs
            ? Object.entries(previousJobs)
                  .filter(([stage]) => relevantStages.includes(stage))
                  .reduce((sum, [, v]) => sum + v, 0)
            : 0;

        return sumCurrent + sumPrevious;
    });

    const title = `${namePrefix} EthProcessorProcessing Time (without mina finalization)`;
    const outFile = `${title.replaceAll(/ /g, '-').toLowerCase()}.png`;
    const binSize = autoBinSizeWithTarget(totalWaits);

    await makeHistogram({
        values: totalWaits,
        title,
        xLabel: 'EthProcessorProcessing Time [Seconds]',
        yLabel: 'Count [Deposits]',
        binSize,
        outFile,
    });

    console.log(`Created chart: '${outFile}'`);
}

async function plotActualOverallTimeFromDepositToCanMint(simulationResult: SimulationResult, namePrefix: string) {
    const totalTimes: number[] = simulationResult.successes.map((success) => {
        const ethFinality = success.timingsMap.WaitingForEthFinality ?? 0;

        const currentJobs = success.timingsMap.WaitingForCurrentJobCompletion;
        const previousJobs = success.timingsMap.WaitingForPreviousJobCompletion;

        const sumCurrent = currentJobs
            ? Object.entries(currentJobs)
                  .filter(([stage]) => stage !== 'EthProcessorTransactionSubmitSucceeded')
                  .reduce((sum, [, v]) => sum + v, 0)
            : 0;

        const sumPrevious = previousJobs
            ? Object.values(previousJobs).reduce((sum, v) => sum + v, 0)
            : 0;

        return ethFinality + sumCurrent + sumPrevious;
    });

    const title = `${namePrefix} Actual Overall Time from Deposit to canMint`;
    const outFile = `${title.replaceAll(/ /g, '-').toLowerCase()}.png`;
    const binSize = autoBinSizeWithTarget(totalTimes);

    await makeHistogram({
        values: totalTimes,
        title,
        xLabel: 'Total Time [Seconds]',
        yLabel: 'Count [Deposits]',
        binSize,
        outFile,
    });

    console.log(`Created chart: '${outFile}'`);
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.length < 1) {
        console.error(
            'Need to provide a canMintDistribution output file as first argument.'
        );
        process.exit(1);
    }
    const inputFile = argv[0];
    const raw = await fs.readFile(inputFile, 'utf8');
    const simulationResult = JSON.parse(raw) as SimulationResult;

    const namePrefix = `Simulation Result ${simulationResult.startedAt}`;

    // Chart all the bridgeTimings
    for (const [stageName, values] of Object.entries(
        simulationResult.bridgeTimingsAggregates
    )) {
        const title = `${namePrefix} ${stageName}`;
        const outFile = `${title.replaceAll(/ /g, '-').toLowerCase()}.png`;
        const binSize = autoBinSizeWithTarget(values); // autoBinSize
        console.log(`Creating chart '${title}' with bin size '${binSize}'`);
        await makeHistogram({
            values,
            title,
            xLabel: `Time until next status after ${stageName} (binned to ${binSize} seconds) [Seconds]`,
            yLabel: 'Count [Unit]',
            binSize,
            outFile,
        });
    }

    // Chart overall deposit times
    const depositTimes = simulationResult.successes.map(
        (success) => success.overallDepositTimeSec
    );
    const binSizeDepositTimes = autoBinSizeWithTarget(depositTimes);
    await makeHistogram({
        values: depositTimes,
        title: `Overall deposit simulation time until BridgeHeadJobCreated after ReadyToMint (slight over estimate of time to ready to mint)`,
        xLabel: `Time until BridgeHeadJobCreated after ReadyToMint [Seconds]`,
        yLabel: 'Count [Unit]',
        binSize: binSizeDepositTimes,
        outFile: `${namePrefix.replaceAll(
            / /g,
            '-'
        )}_deposit_times.png`.toLowerCase(),
    });

    // Chart waiting for eth finality

    const ethFinalityTimes = simulationResult.successes.map(
        (success) => success.timingsMap.WaitingForEthFinality
    );
    const binSizeEthFinalityTimes = autoBinSizeWithTarget(ethFinalityTimes, 20);
    await makeHistogram({
        values: ethFinalityTimes,
        title: `EthFinality wait time vs Count`,
        xLabel: `Time deposit waits for Eth finalization status [Seconds]`,
        yLabel: 'Count [Unit]',
        binSize: binSizeEthFinalityTimes,
        outFile: `${namePrefix.replaceAll(
            / /g,
            '-'
        )}_eth_finality_times.png`.toLowerCase(),
    });

    const firstStageChartTitle = `${namePrefix} First Stage Entered by Deposits`;
    const firstStageOutFile = `${firstStageChartTitle
        .replaceAll(/ /g, '-')
        .toLowerCase()}.png`;
    await makeFirstStageHistogramFromSimulation(
        simulationResult,
        firstStageOutFile,
        firstStageChartTitle,
        'Stage Name',
        'Count [Deposits]'
    );

    await plotTotalBridgeHeadWait(simulationResult, namePrefix);
    await plotTotalBridgeHeadWaitExcludingMina(simulationResult, namePrefix);
    await plotEthProcessorProcessingTime(simulationResult, namePrefix);
    await plotActualOverallTimeFromDepositToCanMint(simulationResult, namePrefix);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
