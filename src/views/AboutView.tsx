// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import { ArrowLeft, FileText, ShieldCheck, Ban, Mail, Award } from 'lucide-react';
import { useTranslation } from '../utils/i18n';
import { LEGAL_CONFIG, getCopyrightLine } from '../config/legal';
import { PortalBackgroundImage } from '../components/PortalBackgroundImage';

interface AboutViewProps {
  onBackHome: () => void;
}

export const AboutView: React.FC<AboutViewProps> = ({ onBackHome }) => {
  const { language, t } = useTranslation();
  const copyrightLine = getCopyrightLine(language);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t.backToApp}</span>
        </button>
      </div>

      {/* Header Banner */}
      <section className="portal-banner-surface relative overflow-hidden rounded-3xl p-6 sm:p-8 shadow-lg">
        <PortalBackgroundImage portal="shopper" variant="banner" />
        <div className="relative z-10">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-white/15 text-white mb-3">
            {t.aboutLegal}
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            {LEGAL_CONFIG.appName}
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100 mt-1.5">
            {t.legalOwnerLabel}: <strong className="text-white">{LEGAL_CONFIG.ownerName}</strong>
          </p>
          <p className="text-xs text-emerald-50/90 mt-2">{copyrightLine}</p>
        </div>
      </section>

      {/* No Payment Notice */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900 shadow-xs flex items-start gap-3">
        <Ban className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <p className="font-bold text-slate-900 dark:text-white mb-0.5">
            {t.noPaymentTitle}
          </p>
          <p>{t.checkoutNotice}</p>
        </div>
      </div>

      {/* Terms of Use */}
      <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t.termsOfUseTitle}
          </h2>
        </div>

        <ul className="space-y-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed list-disc pl-5">
          <li>{t.termsAsIs}</li>
          <li>{t.termsLawfulUse}</li>
          <li>{t.termsNoPayment}</li>
          <li>{t.termsSuspension}</li>
        </ul>
      </section>

      {/* Privacy Notice */}
      <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t.privacyNoticeTitle}
          </h2>
        </div>

        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {t.privacyDataKept}
        </p>
        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {t.privacyNotSold}
        </p>

        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
          <Mail className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p>{t.privacyDeleteInstruction}</p>
            <a
              href={`mailto:${LEGAL_CONFIG.contactEmail}`}
              className="inline-block mt-1 font-mono font-bold text-emerald-700 dark:text-emerald-400 hover:underline break-all"
            >
              {LEGAL_CONFIG.contactEmail}
            </a>
          </div>
        </div>
      </section>

      {/* Loyalty Programme Terms */}
      <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Award className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t.loyaltyTermsTitle}
          </h2>
        </div>

        <ul className="space-y-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed list-disc pl-5">
          <li>{t.loyaltyTermNoCashValue}</li>
          <li>{t.loyaltyTermVerifiedOnly}</li>
          <li>{t.loyaltyTermChanges}</li>
          <li>{t.loyaltyTermFraud}</li>
        </ul>
      </section>
    </div>
  );
};
