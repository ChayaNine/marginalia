import { LinkButton, PageHero } from "@/components/ui";

export default function NotFound() {
  return (
    <PageHero
      eyebrow="404"
      title="That page doesn't exist"
      description="The document or question set may have been deleted."
    >
      <div className="mt-8">
        <LinkButton href="/" variant="primary" size="lg">
          Back to documents
        </LinkButton>
      </div>
    </PageHero>
  );
}
