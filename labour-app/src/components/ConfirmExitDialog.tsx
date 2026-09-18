interface Props {
  touchedCount: number;
  onSubmitAndExit: () => void;
  onDiscardAndExit: () => void;
  onCancel: () => void;
}

/**
 * docs/00-overview.md partial-entry behavior: back navigation with unsaved
 * entries must offer exactly these three explicit choices, never silently
 * discard or silently submit.
 */
export function ConfirmExitDialog({ touchedCount, onSubmitAndExit, onDiscardAndExit, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-xl p-5 max-w-sm w-full space-y-4 border border-gray-700">
        <p className="text-base">
          You have entries for <span className="font-semibold">{touchedCount}</span>{" "}
          {touchedCount === 1 ? "darkstore" : "darkstores"} that haven't been submitted.
        </p>
        <div className="flex flex-col gap-2">
          <button
            className="w-full py-3 rounded-lg bg-emerald-600 active:bg-emerald-700 font-semibold"
            onClick={onSubmitAndExit}
          >
            Submit &amp; exit
          </button>
          <button
            className="w-full py-3 rounded-lg bg-red-700 active:bg-red-800 font-semibold"
            onClick={onDiscardAndExit}
          >
            Discard &amp; exit
          </button>
          <button
            className="w-full py-3 rounded-lg bg-gray-700 active:bg-gray-600 font-semibold"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
