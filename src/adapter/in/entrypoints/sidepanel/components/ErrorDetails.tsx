import { Button } from '@heroui/react';

// An error detail (see fitDetail) for copying into a support request, with a Copy details button.
// Placed outside any live region: a long detail is for copying, not for being read out.
export default function ErrorDetails({ detail }: { detail: string }) {
  return (
    <>
      <section aria-label="Error details" className="mt-2 w-full">
        <div className="w-full rounded-xl bg-surface-secondary p-2 font-mono text-xs break-all whitespace-pre-wrap">
          {detail}
        </div>
      </section>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 self-end"
        onPress={() => {
          void navigator.clipboard?.writeText(detail).catch((error) => {
            console.error('[gcp-console-tint] clipboard copy failed', error);
          });
        }}
      >
        Copy details
      </Button>
    </>
  );
}
