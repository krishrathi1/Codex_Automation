import { useEffect } from 'react';
import { LandingNav } from './components/LandingNav';
import { HeroSection } from './components/HeroSection';
import { FeatureGrid } from './components/FeatureGrid';
import { HowItWorks } from './components/HowItWorks';
import { DashboardPreview } from './components/DashboardPreview';
import { IntegrationSection } from './components/IntegrationSection';
import { CtaSection } from './components/CtaSection';
import { LandingFooter } from './components/LandingFooter';

export function LandingPage() {
  useEffect(() => {
    document.title = 'Nexus — AI Agent Mission Control';
  }, []);

  return (
    <div className="min-h-screen bg-surface-950">
      <LandingNav />
      <main>
        <HeroSection />
        <FeatureGrid />
        <DashboardPreview />
        <HowItWorks />
        <IntegrationSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
