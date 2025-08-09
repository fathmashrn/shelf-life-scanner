import { useEffect } from "react";
import ExpiryScanner from "@/components/ExpiryScanner";
import { Button } from "@/components/ui/button";

const Index = () => {
  useEffect(() => {
    document.title = "Expiry Date Scanner — Check Product Expiration";

    // Structured data (SoftwareApplication)
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Expiry Date Scanner",
      applicationCategory: "Utility",
      operatingSystem: "Web",
      description: "Upload a product label to extract the expiry date and see days left or if it's expired, plus other detected details.",
    });
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="container py-10">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Expiry Date Scanner</h1>
          <p className="text-lg text-muted-foreground">Upload an image of a product label and we’ll detect the expiry date, calculate days left, and extract other useful details automatically.</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <a href="#scanner" className="inline-flex"><Button variant="hero">Get Started</Button></a>
          </div>
        </div>
      </header>

      <main id="scanner" className="container pb-20">
        <ExpiryScanner />
      </main>

      <footer className="container py-8 text-center text-sm text-muted-foreground">
        Built with love. Always double‑check critical dates on packaging.
      </footer>
    </div>
  );
};

export default Index;
