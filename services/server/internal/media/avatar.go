package media

import (
	"bytes"
	"errors"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	MaxAvatarUploadBytes = 5 * 1024 * 1024
	AvatarTargetSize     = 256
)

// ProcessAvatar decodes an uploaded image (JPEG/PNG/GIF/WebP), center-crops it to a square,
// resizes it to 256x256, and encodes it as a compact JPEG (~15-30KB).
func ProcessAvatar(r io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxAvatarUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > MaxAvatarUploadBytes {
		return nil, errors.New("头像文件不能超过 5MB")
	}
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("不支持的图片格式，请上传 PNG / JPG / WebP / GIF")
	}

	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("无效图片尺寸")
	}

	// Center square crop
	side := w
	if h < side {
		side = h
	}
	x0 := b.Min.X + (w-side)/2
	y0 := b.Min.Y + (h-side)/2
	cropRect := image.Rect(x0, y0, x0+side, y0+side)

	dst := image.NewRGBA(image.Rect(0, 0, AvatarTargetSize, AvatarTargetSize))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, cropRect, draw.Over, nil)

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 84}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
