// Shown while a server-rendered page is loading during navigation.

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse pt-16" aria-busy="true" aria-label="Loading">
      <div className="mx-auto h-4 w-24 rounded-full bg-muted" />
      <div className="mx-auto mt-5 h-12 w-2/3 rounded-2xl bg-muted" />
      <div className="mx-auto mt-5 h-4 w-1/2 rounded-full bg-muted" />
      <div className="mt-12 h-56 rounded-3xl bg-muted" />
    </div>
  );
}
