import { notFound, redirect } from 'next/navigation';
import { currentMember } from '@/lib/members';
import StudioLoginForm from './StudioLoginForm';
import { studioLine, studioName } from './studios';

export const dynamic = 'force-dynamic';

/** A studio's own sign-in page, for its members (not the owner's /login). */
export default async function StudioLoginPage({ searchParams }: { searchParams: Promise<{ studio?: string }> }) {
  const studio = (await searchParams).studio ?? '';
  const name = studioName(studio);
  if (!name) notFound();
  const member = await currentMember();
  if (member?.studio === studio) redirect(`/orbit/?studio=${encodeURIComponent(studio)}`);
  return (
    <main className="center">
      <StudioLoginForm studio={studio} name={name} line={studioLine(studio)} />
    </main>
  );
}
