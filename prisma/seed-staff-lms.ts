import { PrismaClient } from "@prisma/client";
import {
  videoCategories,
  videos,
  achievements,
  scenarios,
  quizzes,
  ecycles,
  extraScenarios
} from "./lms-content/data";

export async function seedStaffLms(prisma: PrismaClient) {
  console.log("Seeding Staff LMS content...");

  // 1. Seed Video Categories
  let catCount = 0;
  for (const cat of videoCategories) {
    await prisma.lmsVideoCategory.upsert({
      where: { id: cat.id },
      update: cat,
      create: cat,
    });
    catCount++;
  }
  console.log(`Created/Updated ${catCount} LMS video categories`);

  // 2. Seed Videos
  let vidCount = 0;
  for (const vid of videos) {
    await prisma.lmsVideo.upsert({
      where: { id: vid.id },
      update: vid,
      create: vid,
    });
    vidCount++;
  }
  console.log(`Created/Updated ${vidCount} LMS videos`);

  // 3. Seed Achievements
  let achCount = 0;
  for (const ach of achievements) {
    await prisma.lmsAchievement.upsert({
      where: { id: ach.id },
      update: ach,
      create: ach,
    });
    achCount++;
  }
  console.log(`Created/Updated ${achCount} LMS achievements`);

  // 4. Seed Scenarios
  let scCount = 0;
  const allScenarios = [...scenarios, ...extraScenarios];
  for (const sc of allScenarios) {
    // The legacy seed had checklist as array of objects, which maps to Json in Prisma
    await prisma.lmsScenario.upsert({
      where: { id: sc.id },
      update: sc,
      create: sc,
    });
    scCount++;
  }
  console.log(`Created/Updated ${scCount} LMS scenarios`);

  // 5. Seed Quizzes and their Questions
  let qzCount = 0;
  let qzQuestCount = 0;
  
  const allQuizzes = [...quizzes];

  for (const q of allQuizzes) {
    const { questions: qs, ...quizData } = q;
    
    await prisma.lmsQuiz.upsert({
      where: { id: quizData.id },
      update: quizData,
      create: quizData,
    });
    qzCount++;

    if (qs) {
      for (let i = 0; i < qs.length; i++) {
        const qId = `${quizData.id}-q${i + 1}`;
        await prisma.lmsQuizQuestion.upsert({
          where: { id: qId },
          update: {
            quizId: quizData.id,
            ...qs[i],
            sortOrder: i + 1,
          },
          create: {
            id: qId,
            quizId: quizData.id,
            ...qs[i],
            sortOrder: i + 1,
          },
        });
        qzQuestCount++;
      }
    }
  }
  console.log(`Created/Updated ${qzCount} LMS quizzes with ${qzQuestCount} questions`);

  // 6. Seed E-Cycle Products (LmsProduct)
  let prodCount = 0;
  for (const ec of ecycles) {
    await prisma.lmsProduct.upsert({
      where: { id: ec.id },
      update: ec,
      create: ec,
    });
    prodCount++;
  }
  console.log(`Created/Updated ${prodCount} LMS products (e-cycles)`);

  console.log("Finished seeding Staff LMS content.");
}
