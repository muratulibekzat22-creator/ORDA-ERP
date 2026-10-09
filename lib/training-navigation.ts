export type TrainingLessonNavigationState = {
  key: string;
  videoCompleted: boolean;
  lessonCompleted: boolean;
};

export function trainingLessonCompletionState(input: {
  progressPercent: number;
  requiredCoverage: number;
  questionsCount: number;
  quizPassed: boolean;
}) {
  const videoCompleted = input.progressPercent >= input.requiredCoverage;
  const testRequired = input.questionsCount > 0;
  return {
    videoCompleted,
    testRequired,
    testAvailable: videoCompleted && testRequired && !input.quizPassed,
    lessonCompleted: videoCompleted && (!testRequired || input.quizPassed),
  };
}

export function preferredTrainingLessonKey(
  lessons: TrainingLessonNavigationState[],
  currentLessonKey: string,
) {
  if (lessons.some((lesson) => lesson.key === currentLessonKey))
    return currentLessonKey;

  return (
    lessons.find((lesson) => lesson.videoCompleted && !lesson.lessonCompleted)?.key ??
    lessons.find((lesson) => !lesson.videoCompleted)?.key ??
    lessons.find((lesson) => !lesson.lessonCompleted)?.key ??
    lessons[0]?.key ??
    ""
  );
}
