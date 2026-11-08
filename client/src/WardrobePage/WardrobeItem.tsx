/**
 * This is the format the database returns upon request,
 * for each item.
 *
 * This is the generated versio from wardrobeItem.
 */
export type WardrobeItem = {
  image_id: number;
  file_name: string;
  caption: string;
  tags: string[];
  uploaded_at: string;
};
