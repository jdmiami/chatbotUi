import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="center">
      <div className="card">
        <h1>Page not found</h1>
        <p className="muted">This address doesn&apos;t exist. It may have been mistyped or moved.</p>
        <div className="row">
          <Link className="button" href="/">
            Go to your workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
