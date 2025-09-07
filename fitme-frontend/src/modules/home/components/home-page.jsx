import React from 'react';
import Navbar from './navbar';
import Hero from './hero-banner';
import Features from './features';
import Testimonials from './testimonials';
import FAQSection from './faq-section';
import Footer from './footer';
import PricingSection from './pricing-section';

const LandingPage = () => (
  <div className="font-sans scroll-smooth">
    <Navbar />
    <Hero />
    <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent opacity-250" />
    <Features />
    <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent opacity-250" />
    <Testimonials />
    <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent opacity-250" />
    <PricingSection />
    <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent opacity-250" />
    <FAQSection />
    <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent opacity-250" />
    <Footer />
  </div>
);

export default LandingPage;
