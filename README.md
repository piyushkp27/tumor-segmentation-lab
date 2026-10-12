# Lab 1 · Three ways to outline a brain tumor

An interactive lab page for a lecture on image segmentation. Students segment the
same MRI slice three times and compare the results:

1. **By hand**: outline, brush and eraser tools, an 8× magnifier, a timer and a
   repeatability test (draw it twice, get the Dice between your own attempts).
2. **Otsu's threshold**: live histogram with the between-class variance curve,
   a draggable threshold, a region-of-interest box, and clean-up steps (opening,
   keep one blob, fill holes) shown one step at a time.
3. **Active contour (snake)**: Kass–Witkin–Terzopoulos snake with a Cohen balloon
   force, animated, with sliders for α, β, w, κ and σ, the edge map, and the force
   field. Optional: seeded region growing.
4. **Compare**: outlines or an agreement map, plus Dice and HD95 against a reference
   of your choice.

Image C is a simulated phantom with a stored true mask, so it is the one case
where every method can be scored against the right answer.

Everything runs in the browser. There is no build step and nothing is uploaded.

## Run it locally

The page uses ES modules and reads image pixels, so it has to be served over HTTP
(opening `index.html` straight from disk will not work):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

```
index.html        the handout: text, tasks, questions
css/style.css
js/main.js        loads images, builds the image picker
js/state.js       shared state (current image, masks)
js/imgproc.js     blur, gradient, Otsu, connected components, morphology,
                  hole filling, distance transform, Dice, HD95
js/manual.js      Exercise 1
js/otsu.js        Exercise 2
js/snake.js       Exercise 3a (semi-implicit snake, circulant solver)
js/grow.js        Exercise 3b
js/compare.js     Exercise 4
img/              the three slices and the phantom's true mask
```

## Credits

Images A and B: axial MRI of a glioblastoma by Hellerhoff, via
[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Glioblastoma_multiforme_-_MRT_T1KM_ax.jpg),
licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Cropped and
resized to 512 × 512. Image C was generated for this lab.
