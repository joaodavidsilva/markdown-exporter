import { throwIfCancelled } from './cancellation';
import { ResolvedConfiguration } from './configuration';
import { DestinationDelivery } from './destinations';
import { createExport, ExportStatistics } from './export';
import { ExpansionEntry } from './expansion';
import { ProgressReporter } from './progress';

/** Everything delivering an Export needs, resolved by the adapter (ADR-0001). */
export interface DeliveryRequest {
    /** The output of expandSelection, in the order it will be rendered. */
    entries: ExpansionEntry[];
    configuration: ResolvedConfiguration;
    /** Where the Export goes. The only thing that differs between commands. */
    delivery: DestinationDelivery;
    /** Aborts the rendering, and so the delivery with it. */
    signal?: AbortSignal;
    onProgress?: ProgressReporter;
}

/**
 * Render an Export and deliver it — or leave the Destination as it was found.
 *
 * Every Destination fails the same way. A file is written through, so a
 * failure has already put bytes on disk and discarding removes them; the
 * clipboard is buffered, so a failure has written nothing and discarding
 * drops what was held. Either way, an Export that did not finish is not one
 * the user is given half of, and both Destinations get that guarantee from
 * here rather than each arranging it for itself.
 */
export async function deliverExport(request: DeliveryRequest): Promise<ExportStatistics> {
    const { entries, configuration, delivery, signal, onProgress } = request;

    // Nothing is opened until the Export is about to be rendered, so an
    // Export cancelled during its Expansion never reaches its Destination at
    // all — there is nothing to discard.
    throwIfCancelled(signal);

    const destination = await delivery.open();
    let delivered = false;

    try {
        const statistics = await createExport({
            entries,
            configuration,
            destination,
            signal,
            onProgress
        });

        await delivery.commit();
        delivered = true;

        return statistics;
    } finally {
        // Committing is itself a step that can fail, so what decides between
        // the two paths is whether the Export was handed over, not whether
        // rendering threw.
        if (!delivered) {
            await delivery.discard();
        }
    }
}
