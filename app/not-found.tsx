import Link from 'next/link';
import Masthead from './Masthead';

export default function NotFound() {
  return (
    <main className="center">
      <div className="card">
        <Masthead section="Not found" title="This page isn’t here." standfirst="The address may have been mistyped or moved." />
        <div className="row">
          <Link className="button" href="/">
            Back to Orbit
          </Link>
        </div>
      </div>
    </main>
  );
}
